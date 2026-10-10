// DUNYATEK — iOS: PC ile sesli görüşmenin yerel ses motoru.
//
// Neden yerel: WKWebView'in yankı engeli (VoiceProcessingIO) Web Audio ile çalınan sesi
// referans almaz; telefonun hoparlöründen çıkan DUNYATEK sesi mikrofona girip PC'ye geri
// gidiyordu (yankı ve gecikme). Burada mikrofon ve hoparlör TEK bir AVAudioEngine'dedir,
// ses işleme (yankı engeli) açıktır: çalınan ses aynı motordan çıktığı için iOS onu tanır
// ve mikrofondan siler. Google'ın Gemini Live iOS örneği (firebase/quickstart-ios
// AudioController.swift) ve pipecat-client-ios-gemini-live-websocket aynı yapıyı kullanır.
//
// Akış (Android'deki web yolu ile aynı protokol, WS /ws/phone-audio?speaker=1):
//   mikrofon → 16 kHz 16-bit mono PCM, 1024 örneklik (64 ms) parçalar → PC
//   PC → 24 kHz 16-bit mono PCM → AVAudioPlayerNode (karıştırıcı donanım hızına çevirir)
//   PC metin mesajları: {"type":"merhaba","kes":bool} / {"type":"kes"} (çalan sesi sustur)
// Söz kesme telefonda da yapılır (simplePc.js / sozKesme.ts ile aynı karar).
// Adres (içinde oturum anahtarı var) hiçbir yere yazılmaz.

import AVFoundation
import Foundation

/// sozKesme.ts SozKesme ile aynı: asistan konuşurken mikrofonun tipik seviyesi ölçülür,
/// kullanıcının sesi bunun 2 katı ve en az 0.30 ise oy verir; son 8 parçada 5 oy = kes.
final class SozKesmeSayaci {
    private var oylar: [Bool] = []
    private var seviyeler: [Double] = []

    func reset() { oylar = [] }

    func feed(_ seviye: Double) -> Bool {
        var beklenen = 0.0
        if seviyeler.count >= 6 {
            let s = seviyeler.sorted(); let m = s.count / 2
            beklenen = s.count % 2 == 1 ? s[m] : (s[m - 1] + s[m]) / 2
        }
        let oy = seviyeler.count >= 6 && seviye >= 0.3 && seviye >= beklenen * 2.0
        oylar.append(oy); if oylar.count > 8 { oylar.removeFirst(oylar.count - 8) }
        if !oy { seviyeler.append(seviye); if seviyeler.count > 48 { seviyeler.removeFirst(seviyeler.count - 48) } }
        if oylar.filter({ $0 }).count >= 5 { oylar = []; return true }
        return false
    }
}

final class SesMotoru: NSObject {
    static let pcHizi: Double = 24000      // PC'nin (Gemini Live) konuşma sesi
    static let micHizi: Double = 16000     // PC'nin beklediği mikrofon sesi
    static let parca = 1024                // 16 kHz'de 64 ms
    static let kuyrukSn: Double = 0.3      // cümle aralarında "çalıyor" sayılmaya devam
    static let kendiSusmaSn: Double = 2.5  // telefon kendi susturunca PC onayı beklenen süre
    static let isinmaSn: Double = 1.5      // yankı engeli ısınırken mikrofon PC'ye sessizlik yollar

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let pcBicim = AVAudioFormat(standardFormatWithSampleRate: SesMotoru.pcHizi, channels: 1)!
    private let micBicim = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: SesMotoru.micHizi,
                                         channels: 1, interleaved: true)!
    private var donustur: AVAudioConverter?
    private var urlOturum: URLSession?
    private var soket: URLSessionWebSocketTask?
    private var gozlemciler: [NSObjectProtocol] = []

    // Ortak durum (ses iş parçacığı, soket ve JS sorgusu arasında): kilit altında.
    private let kilit = NSLock()
    private var acik = false
    private var bitti = false
    private var sesGeldi = false
    private var bekleyen = 0          // çalınmayı bekleyen parça sayısı
    private var nesil = 0             // susturunca eski parçaların geri bildirimi yok sayılır
    private var sonCalma = Date.distantPast
    private var calinanSn: Double = 0 // bu görüşmede çalınan toplam süre (ısınma için)
    private var micSeviye: Double = 0
    private var cikisSeviye: Double = 0
    private var sonGonderim = Date()
    private var kesSayac = 0
    private var pcSozKesme = false
    private var kendiSustu: Date?
    private let sozKesme = SozKesmeSayaci()
    private var micTampon: [Int16] = []

    @discardableResult
    private func kilitli<T>(_ f: () -> T) -> T { kilit.lock(); defer { kilit.unlock() }; return f() }

    // ── başlat / durdur ──
    func baslat(_ adres: URL) throws {
        let oturum = AVAudioSession.sharedInstance()
        try oturum.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
        try? oturum.setPreferredIOBufferDuration(0.02)
        try oturum.setActive(true)

        let giris = engine.inputNode
        try giris.setVoiceProcessingEnabled(true)   // yankı engeli: motor başlamadan önce
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: pcBicim)

        let girisBicim = giris.outputFormat(forBus: 0)
        guard girisBicim.sampleRate > 0, girisBicim.channelCount > 0,
              let tekKanal = AVAudioFormat(standardFormatWithSampleRate: girisBicim.sampleRate, channels: 1),
              let cevir = AVAudioConverter(from: tekKanal, to: micBicim) else {
            throw NSError(domain: "DUNYATEK", code: 1, userInfo: [NSLocalizedDescriptionKey: "Mikrofon açılamadı."])
        }
        donustur = cevir
        giris.installTap(onBus: 0, bufferSize: 1024, format: girisBicim) { [weak self] b, _ in
            self?.mikrofon(b, tekKanal)
        }
        player.installTap(onBus: 0, bufferSize: 1024, format: pcBicim) { [weak self] b, _ in
            let s = SesMotoru.rms(b)
            self?.kilitli { self?.cikisSeviye = s }
        }
        engine.prepare()
        try engine.start()
        player.play()

        // Kulaklık/hoparlör değişimi ya da kesinti (arama) motoru durdurur. Aynı motoru yeniden
        // başlatmak güvenli değil (Bluetooth'ta mikrofon hızı değişir, eski dinleyici çöker):
        // görüşme biter, uygulama birkaç saniye içinde yeni biçimle kendisi yeniden açar.
        let nc = NotificationCenter.default
        gozlemciler.append(nc.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine,
                                          queue: .main) { [weak self] _ in
            if self?.engine.isRunning == false { self?.durdur() }
        })
        gozlemciler.append(nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil,
                                          queue: .main) { [weak self] n in
            let tur = (n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt)
                .flatMap(AVAudioSession.InterruptionType.init(rawValue:))
            if tur == .began { self?.durdur() }
        })

        let us = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        urlOturum = us
        let ws = us.webSocketTask(with: adres)
        soket = ws
        kilitli { sonGonderim = Date() }
        ws.resume()
        dinle(ws)
    }

    func durdur() {
        let ilk: Bool = kilitli {
            if bitti { return false }
            bitti = true; acik = false
            return true
        }
        guard ilk else { return }
        gozlemciler.forEach { NotificationCenter.default.removeObserver($0) }
        gozlemciler = []
        soket?.cancel(with: .normalClosure, reason: nil)
        urlOturum?.invalidateAndCancel()
        engine.inputNode.removeTap(onBus: 0)
        player.removeTap(onBus: 0)
        player.stop()
        engine.stop()
        try? engine.inputNode.setVoiceProcessingEnabled(false)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// JS bunu ~100 ms'de bir sorar (ekrandaki yüz, sağlık kontrolü, söz kesme klibi).
    func durum() -> [String: Any] {
        kilitli {
            let calan = bekleyen > 0 || Date().timeIntervalSince(sonCalma) < SesMotoru.kuyrukSn
            return ["open": acik && !bitti, "closed": bitti, "gotAudio": sesGeldi,
                    "playing": sesGeldi && calan, "mic": micSeviye, "out": calan ? cikisSeviye : 0,
                    "sinceSentMs": Int(Date().timeIntervalSince(sonGonderim) * 1000), "kesSeq": kesSayac]
        }
    }

    // ── PC'den gelenler ──
    private func dinle(_ ws: URLSessionWebSocketTask) {
        ws.receive { [weak self] sonuc in
            guard let self = self else { return }
            switch sonuc {
            case .failure:
                self.durdur()
            case .success(let m):
                switch m {
                case .data(let d): self.cal(d)
                case .string(let s): self.mesaj(s)
                @unknown default: break
                }
                if !self.kilitli({ self.bitti }) { self.dinle(ws) }
            }
        }
    }

    private func mesaj(_ s: String) {
        guard let d = s.data(using: .utf8),
              let m = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let tur = m["type"] as? String else { return }
        if tur == "merhaba" { kilitli { pcSozKesme = (m["kes"] as? Bool) == true } }
        if tur == "kes" { sustur(); kilitli { kendiSustu = nil } }  // PC kesti: sonraki ses yeni cevap
    }

    private func cal(_ d: Data) {
        let n = d.count / 2
        guard n > 0 else { return }
        let atla: Bool = kilitli {
            if bitti { return true }
            if let t = kendiSustu {
                if Date().timeIntervalSince(t) < SesMotoru.kendiSusmaSn { return true } // kesilen cevabın artığı
                kendiSustu = nil
            }
            return false
        }
        if atla { return }
        guard let b = AVAudioPCMBuffer(pcmFormat: pcBicim, frameCapacity: AVAudioFrameCount(n)),
              let ch = b.floatChannelData?[0] else { return }
        b.frameLength = AVAudioFrameCount(n)
        d.withUnsafeBytes { (ham: UnsafeRawBufferPointer) in
            for i in 0..<n {
                let v = Int16(littleEndian: ham.loadUnaligned(fromByteOffset: i * 2, as: Int16.self))
                ch[i] = Float(v) / 32768
            }
        }
        let sure = Double(n) / SesMotoru.pcHizi
        let benim: Int = kilitli { sesGeldi = true; bekleyen += 1; return nesil }
        player.scheduleBuffer(b, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            guard let self = self else { return }
            self.kilitli {
                guard self.nesil == benim else { return }
                self.bekleyen = max(0, self.bekleyen - 1)
                self.sonCalma = Date()
                self.calinanSn += sure
            }
        }
        if !player.isPlaying { player.play() }
    }

    /// Çalan ve sırada bekleyen sesi hemen sustur (söz kesildi).
    private func sustur() {
        kilitli { nesil += 1; bekleyen = 0; sonCalma = .distantPast; sozKesme.reset() }
        player.stop()   // sıradaki parçaları da atar
        player.play()
    }

    // ── mikrofon → PC ──
    private func mikrofon(_ b: AVAudioPCMBuffer, _ tekKanal: AVAudioFormat) {
        guard let cevir = donustur, let kaynak = b.floatChannelData?[0], b.frameLength > 0,
              let mono = AVAudioPCMBuffer(pcmFormat: tekKanal, frameCapacity: b.frameLength),
              let hedef = mono.floatChannelData?[0] else { return }
        mono.frameLength = b.frameLength
        hedef.update(from: kaynak, count: Int(b.frameLength))   // yalnız ilk kanal
        let kapasite = AVAudioFrameCount(Double(b.frameLength) * SesMotoru.micHizi / tekKanal.sampleRate) + 32
        guard let cikti = AVAudioPCMBuffer(pcmFormat: micBicim, frameCapacity: kapasite) else { return }
        var verildi = false
        var hata: NSError?
        cevir.convert(to: cikti, error: &hata) { _, durum in
            if verildi { durum.pointee = .noDataNow; return nil }
            verildi = true; durum.pointee = .haveData; return mono
        }
        guard hata == nil, cikti.frameLength > 0, let ornek = cikti.int16ChannelData?[0] else { return }
        let seviye = SesMotoru.rms(b)
        var gonder: [Data] = []
        var kes = false
        kilitli {
            micSeviye = seviye
            micTampon.append(contentsOf: UnsafeBufferPointer(start: ornek, count: Int(cikti.frameLength)))
            while micTampon.count >= SesMotoru.parca {
                var p = Array(micTampon.prefix(SesMotoru.parca))
                micTampon.removeFirst(SesMotoru.parca)
                let calan = sesGeldi && (bekleyen > 0 || Date().timeIntervalSince(sonCalma) < SesMotoru.kuyrukSn)
                if calan && calinanSn < SesMotoru.isinmaSn {
                    // Yankı engeli henüz çalınan sesi öğrenmedi: ilk saniyede PC'ye sessizlik.
                    p = [Int16](repeating: 0, count: p.count)
                    sozKesme.reset()
                } else if calan && pcSozKesme {
                    if sozKesme.feed(SesMotoru.pcmSeviye(p)) { kes = true }
                } else {
                    sozKesme.reset()
                }
                gonder.append(p.withUnsafeBufferPointer { Data(buffer: $0) })
            }
        }
        guard let ws = soket else { return }
        for d in gonder {
            ws.send(.data(d)) { [weak self] h in
                if h == nil { self?.kilitli { self?.sonGonderim = Date() } }
            }
        }
        if kes {
            sustur()
            kilitli { kendiSustu = Date(); kesSayac += 1 }
            ws.send(.string("{\"type\":\"kes\"}")) { _ in }
        }
    }

    // ── seviyeler ──
    /// 0..1, ekrandaki yüz için (simplePc.js rms ile aynı ölçek: rms × 5).
    static func rms(_ b: AVAudioPCMBuffer) -> Double {
        guard let c = b.floatChannelData?[0], b.frameLength > 0 else { return 0 }
        var t: Float = 0
        for i in 0..<Int(b.frameLength) { t += c[i] * c[i] }
        return min(1, Double((t / Float(b.frameLength)).squareRoot()) * 5)
    }

    /// sozKesme.ts pcmSeviye ile aynı (PC'deki _pcm_level ölçeği).
    static func pcmSeviye(_ p: [Int16]) -> Double {
        guard !p.isEmpty else { return 0 }
        var t: Double = 0
        for v in p { let x = Double(v); t += x * x }
        let r = (t / Double(p.count)).squareRoot()
        if r <= 60 { return 0 }
        return min(1, (r - 60) / (2600 - 60))
    }
}

extension SesMotoru: URLSessionWebSocketDelegate {
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didOpenWithProtocol protocol: String?) {
        kilitli { acik = true; sonGonderim = Date() }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        durdur()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        durdur()
    }
}
