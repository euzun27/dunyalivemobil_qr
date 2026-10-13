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
    static let isinmaSn: Double = 1.5      // çalmanın ilk saniyesinde barge-in kapalı (mikrofon güvenilmez)
    static let onDolumSn: Double = 0.12    // çalmadan önce biriktirilen ses tamponu (jitter yastığı)

    // Tek motor: uygulama boyunca yaşar, hiç silinmez. Yankı engeli açık bir motoru silmek
    // iOS'ta çökme yapıyordu (2026-10-11 çökme raporu: Apple'ın arka plandaki temizlik işi
    // silinmiş nesneye dokunuyor, EXC_BAD_ACCESS objc_release). Firebase ve pipecat
    // örnekleri de motoru bir kez kurup durdurup yeniden başlatır.
    // Motor, dinleyiciler ve çalıcının başlat/durdur işleri yalnız ana iş parçacığında yapılır.
    private static let ortakMotor = AVAudioEngine()
    private static let ortakCalici = AVAudioPlayerNode()
    private static var hazir = false            // yankı engeli açıldı, çalıcı takıldı
    private static var sahip: SesMotoru?         // motoru şu an kullanan görüşme (ana iş parçacığı)
    private var engine: AVAudioEngine { SesMotoru.ortakMotor }
    private var player: AVAudioPlayerNode { SesMotoru.ortakCalici }
    private let pcBicim = AVAudioFormat(standardFormatWithSampleRate: SesMotoru.pcHizi, channels: 1)!
    private let micBicim = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: SesMotoru.micHizi,
                                         channels: 1, interleaved: true)!
    private var donustur: AVAudioConverter?   // yalnız mikrofon iş parçacığında kullanılır
    private var tekKanal: AVAudioFormat?
    private var urlOturum: URLSession?
    private var soket: URLSessionWebSocketTask?
    private var gozlemciler: [NSObjectProtocol] = []

    // Ortak durum (ses iş parçacığı, soket ve JS sorgusu arasında): kilit altında.
    private let kilit = NSLock()
    private var acik = false
    private var bitti = false
    private var sesGeldi = false
    private var bekleyen = 0          // çalınmayı bekleyen parça sayısı
    private var bekleyenSn: Double = 0 // çalıcıya verilmiş ama daha çalınmamış ses (saniye)
    private var calmaBasladi = false  // bu söz için play() çağrıldı mı (ön dolum bitti mi)
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
    private var hataMetni = ""       // görüşme neden bitti (JS ekranda gösterir)

    @discardableResult
    private func kilitli<T>(_ f: () -> T) -> T { kilit.lock(); defer { kilit.unlock() }; return f() }

    // ── başlat / durdur (ana iş parçacığında) ──
    /// adim: o an yapılan iş; PhonePlugin kalıcı ayara yazar, çökerse sonraki denemede görünür.
    func baslat(_ adres: URL, adim: (String) -> Void) throws {
        adim("ses oturumu ayarlanıyor")
        let oturum = AVAudioSession.sharedInstance()
        try oturum.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
        try? oturum.setPreferredIOBufferDuration(0.02)
        try oturum.setActive(true)   // görüşme bitince kapatılmaz (aç/kapa çökmeye yol açıyordu)

        adim("önceki görüşme temizleniyor")
        SesMotoru.temizle()
        let giris = engine.inputNode
        if !SesMotoru.hazir {
            adim("yankı engeli açılıyor")
            try giris.setVoiceProcessingEnabled(true)   // bir kez, motor başlamadan önce; açık kalır
            engine.attach(player)
            SesMotoru.hazir = true
        }
        adim("hoparlör bağlanıyor")
        engine.connect(player, to: engine.mainMixerNode, format: pcBicim)

        let girisBicim = giris.outputFormat(forBus: 0)
        guard girisBicim.sampleRate > 0, girisBicim.channelCount > 0 else {
            throw NSError(domain: "DUNYATEK", code: 1, userInfo: [NSLocalizedDescriptionKey: "Mikrofon açılamadı."])
        }
        adim("mikrofon dinleyicisi kuruluyor")
        // format: nil = düğümün gerçek biçimi. Biçimi elle vermek, yankı engeli açıkken
        // donanım hızı farklı olduğunda AVAudioEngine'i çökertebiliyor.
        giris.installTap(onBus: 0, bufferSize: 1024, format: nil) { [weak self] b, _ in
            self?.mikrofon(b)
        }
        player.installTap(onBus: 0, bufferSize: 1024, format: nil) { [weak self] b, _ in
            let s = SesMotoru.rms(b)
            self?.kilitli { self?.cikisSeviye = s }
        }
        adim("ses motoru başlatılıyor")
        SesMotoru.sahip = self
        engine.prepare()
        try engine.start()
        oynat()

        // Kulaklık/hoparlör değişimi ya da yankı engelinin kendi ayarı motoru durdurabilir.
        // Mikrofon biçimi aynıysa motor yeniden başlatılır (ilk açılışta da gelebiliyor).
        // Biçim değiştiyse (ör. Bluetooth) eski dinleyiciyle başlatmak çöker: görüşme biter,
        // uygulama birkaç saniye içinde yeni biçimle kendisi yeniden açar.
        let nc = NotificationCenter.default
        gozlemciler.append(nc.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine,
                                          queue: .main) { [weak self] _ in
            self?.ayarDegisti(girisBicim)
        })
        gozlemciler.append(nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil,
                                          queue: .main) { [weak self] n in
            let tur = (n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt)
                .flatMap(AVAudioSession.InterruptionType.init(rawValue:))
            if tur == .began { self?.durdur("Ses kesintisi (arama, alarm vb.).") }
        })

        adim("bilgisayara bağlanılıyor")
        let us = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        urlOturum = us
        let ws = us.webSocketTask(with: adres)
        soket = ws
        kilitli { sonGonderim = Date() }
        ws.resume()
        dinle(ws)
    }

    private func ayarDegisti(_ eski: AVAudioFormat) {
        guard !kilitli({ bitti }), !engine.isRunning else { return }
        let yeni = engine.inputNode.outputFormat(forBus: 0)
        guard yeni.sampleRate == eski.sampleRate, yeni.channelCount == eski.channelCount else {
            durdur("Ses aygıtı değişti (kulaklık/hoparlör)."); return
        }
        engine.prepare()
        do {
            try engine.start()
            oynat()
        } catch {
            durdur("Ses motoru yeniden başlatılamadı: \(error.localizedDescription)")
        }
    }

    func durdur(_ sebep: String = "") {
        let ilk: Bool = kilitli {
            if bitti { return false }
            bitti = true; acik = false
            if hataMetni.isEmpty { hataMetni = sebep }
            return true
        }
        guard ilk else { return }
        soket?.cancel(with: .normalClosure, reason: nil)
        urlOturum?.invalidateAndCancel()
        // Soket kapanınca bu, ağ iş parçacığından gelir: motoru orada durdurmak ana iş
        // parçacığındaki başlatmayla çakışıyordu. Motor işi hep ana iş parçacığında.
        if Thread.isMainThread { kapat() } else { DispatchQueue.main.async { self.kapat() } }
    }

    private func kapat() {
        gozlemciler.forEach { NotificationCenter.default.removeObserver($0) }
        gozlemciler = []
        // Yeni görüşme motoru devraldıysa ona dokunma (eski görüşmenin geç gelen kapanışı).
        guard SesMotoru.sahip == nil || SesMotoru.sahip === self else { return }
        SesMotoru.temizle()
        SesMotoru.sahip = nil
    }

    /// Dinleyicileri sök, çalmayı ve motoru durdur. Motor silinmez, yankı engeli açık kalır.
    private static func temizle() {
        ortakMotor.inputNode.removeTap(onBus: 0)
        ortakCalici.removeTap(onBus: 0)
        ortakCalici.stop()
        if ortakMotor.isRunning { ortakMotor.stop() }
    }

    /// JS bunu ~100 ms'de bir sorar (ekrandaki yüz, sağlık kontrolü, söz kesme klibi).
    func durum() -> [String: Any] {
        kilitli {
            let calan = bekleyen > 0 || Date().timeIntervalSince(sonCalma) < SesMotoru.kuyrukSn
            return ["open": acik && !bitti, "closed": bitti, "gotAudio": sesGeldi,
                    "playing": sesGeldi && calan, "mic": micSeviye, "out": calan ? cikisSeviye : 0,
                    "sinceSentMs": Int(Date().timeIntervalSince(sonGonderim) * 1000), "kesSeq": kesSayac,
                    "error": hataMetni]
        }
    }

    // ── PC'den gelenler ──
    private func dinle(_ ws: URLSessionWebSocketTask) {
        ws.receive { [weak self] sonuc in
            guard let self = self else { return }
            switch sonuc {
            case .failure(let e):
                self.durdur("Bağlantı koptu: \(e.localizedDescription)")
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
        // Ön dolum: ilk parçada hemen play() demek, ağda ufak bir takılmada çalıcıyı aç
        // bırakıyor (underrun) → hoparlörde cızırtı/patlama. Önce ~120 ms ses biriktir,
        // sonra çal; kuyruk tam boşalırsa (jitter) bir sonraki söz yeniden biriktirir.
        var benim = 0
        var calsin = false
        var zamanlayiciKur = false
        kilitli {
            sesGeldi = true
            let onceki = bekleyen
            bekleyen += 1
            bekleyenSn += sure
            if !calmaBasladi {
                if bekleyenSn >= SesMotoru.onDolumSn { calmaBasladi = true; calsin = true }
                else if onceki == 0 { zamanlayiciKur = true }
            } else {
                calsin = true
            }
            benim = nesil
        }
        player.scheduleBuffer(b, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            guard let self = self else { return }
            self.kilitli {
                guard self.nesil == benim else { return }
                self.bekleyen = max(0, self.bekleyen - 1)
                self.bekleyenSn = max(0, self.bekleyenSn - sure)
                if self.bekleyen == 0 { self.calmaBasladi = false } // kuyruk boşaldı: sonraki söz yeniden ön dolum
                self.sonCalma = Date()
                self.calinanSn += sure
            }
        }
        if zamanlayiciKur {   // kısa cevap ön dolum eşiğini geçmezse yine de çalınsın
            let g = benim
            DispatchQueue.main.asyncAfter(deadline: .now() + SesMotoru.onDolumSn) { [weak self] in
                self?.onDolumBitti(g)
            }
        }
        if calsin { oynat() }
    }

    /// Ön dolum süresi dolunca: yeterli ses birikmese bile (kısa cevap) çalmaya başla.
    private func onDolumBitti(_ g: Int) {
        let cal: Bool = kilitli {
            guard nesil == g, !calmaBasladi, bekleyen > 0 else { return false }
            calmaBasladi = true
            return true
        }
        if cal { oynat() }
    }

    /// Çalan ve sırada bekleyen sesi hemen sustur (söz kesildi).
    private func sustur() {
        kilitli { nesil += 1; bekleyen = 0; bekleyenSn = 0; calmaBasladi = false; sonCalma = .distantPast; sozKesme.reset() }
        anaIste { [weak self] in
            guard let self = self, SesMotoru.sahip === self, !self.kilitli({ self.bitti }) else { return }
            self.player.stop()   // sıradaki parçaları da atar
            self.oynat()
        }
    }

    /// Motor çalışmıyorken play() AVAudioEngine'i çökertir (uygulama kapanır). Ana iş
    /// parçacığında: motor orada durdurulur, aynı anda çalmaya başlamak çakışmasın.
    private func oynat() {
        anaIste { [weak self] in
            guard let self = self, SesMotoru.sahip === self, !self.kilitli({ self.bitti }) else { return }
            if self.engine.isRunning && !self.player.isPlaying { self.player.play() }
        }
    }

    private func anaIste(_ f: @escaping () -> Void) {
        if Thread.isMainThread { f() } else { DispatchQueue.main.async(execute: f) }
    }

    // ── mikrofon → PC ──
    private func mikrofon(_ b: AVAudioPCMBuffer) {
        let hiz = b.format.sampleRate
        guard hiz > 0, b.frameLength > 0 else { return }
        if tekKanal?.sampleRate != hiz {   // ilk parça ya da donanım hızı değişti
            guard let f = AVAudioFormat(standardFormatWithSampleRate: hiz, channels: 1),
                  let c = AVAudioConverter(from: f, to: micBicim) else { return }
            tekKanal = f; donustur = c
        }
        guard let cevir = donustur, let tekKanal = tekKanal, let kaynak = b.floatChannelData?[0],
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
                if calan {
                    // Asistan konuşurken PC'ye HEP sessizlik gönder. Yankı engeli (AEC)
                    // hoparlörden/kulaklıktan mikrofona sızan asistan sesini tam bastıramıyor;
                    // o kalıntı PC'ye giderse asistan kendi sesini duyup tekrar tekrar
                    // yankılıyordu (kulaklıkta da sürüyordu: akustik değil, iletim sorunu).
                    // Söz kesme yerelde gerçek mikrofonla sürer: kullanıcı araya girince
                    // aşağıda "kes" PC'ye gider, çalma durunca (calan=false) mikrofon yeniden akar.
                    if calinanSn >= SesMotoru.isinmaSn && pcSozKesme {
                        if sozKesme.feed(SesMotoru.pcmSeviye(p)) { kes = true }
                    } else {
                        sozKesme.reset()   // ısınma sırasında barge-in kapalı (mikrofon henüz güvenilmez)
                    }
                    p = [Int16](repeating: 0, count: p.count)
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
        durdur("Bilgisayar ses bağlantısını kapattı (kod \(closeCode.rawValue)).")
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        durdur(error.map { "Bağlantı kurulamadı: \($0.localizedDescription)" } ?? "Bağlantı kapandı.")
    }
}
