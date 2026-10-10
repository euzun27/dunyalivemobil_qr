// DUNYATEK — iOS: tauri-plugin-phone (Android karşılığı: android/src/main/java/PhonePlugin.kt).
//
// iOS'ta olanlar:
//   • identity*      PC eşleşme kimliği: P-256 ECDSA (SHA256withECDSA ile aynı DER imza),
//                    gizli anahtar Keychain'de (yalnızca bu cihaz), sayaç imzadan ÖNCE kaydedilir.
//   • configSecret*  anahtarlar Keychain'de.
//   • voiceStart / voiceStop / voicePoll: PC ile sesli görüşme, yerel ses motoru (SesMotoru.swift).
//   • speak / stopSpeaking / pollSpeaking (AVSpeechSynthesizer), openUrl, readClipboard,
//     getDeviceStats (pil), isEnabled (her zaman false: iOS erişilebilirlik kontrolüne izin vermez).
// Diğer komutlar burada yok: Tauri onları "No command ... found" diye reddeder, JS tarafı
// bunu "telefonda desteklenmiyor" olarak ele alır.

import AVFoundation
import CryptoKit
import Foundation
import Security
import Tauri
import UIKit
import WebKit

// ── argümanlar (Rust models.rs ile aynı camelCase alanlar) ─────────────────
class SpeakArgs: Decodable { var text: String = "" }
class VoiceStartArgs: Decodable { var url: String = "" }
class OpenUrlArgs: Decodable { var url: String = "" }
class SecretNameArgs: Decodable { var name: String = "" }
class SecretSetArgs: Decodable { var name: String = ""; var value: String = "" }
class AuthArgs: Decodable { var hostId: String = ""; var nonce: String = "" }
class EnvelopeArgs: Decodable {
    var connectionNonce: String = ""; var messageType: String = ""
    var taskId: String = ""; var payloadDigest: String = ""
}
class PairingArgs: Decodable {
    var hostId: String = ""; var challengeId: String = ""
    var connectionNonce: String = ""; var deviceName: String = "Aura phone"
}
class HostChallengeArgs: Decodable {
    var publicKey: String = ""; var expectedFingerprint: String = ""; var hostId: String = ""
    var nonce: String = ""; var expiresAt: Int64 = 0; var connectionId: String = ""
    var signature: String = ""
}
class HostEnvelopeArgs: Decodable {
    var publicKey: String = ""; var expectedFingerprint: String = ""; var hostId: String = ""
    var connectionNonce: String = ""; var counter: Int64 = 0; var messageType: String = ""
    var taskId: String = ""; var payloadDigest: String = ""; var signature: String = ""
}

// ── Keychain ───────────────────────────────────────────────────────────────
enum Keychain {
    static func set(_ service: String, _ account: String, _ data: Data) -> Bool {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                   kSecAttrService as String: service,
                                   kSecAttrAccount as String: account]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    static func get(_ service: String, _ account: String) -> Data? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccount as String: account,
                                kSecReturnData as String: true,
                                kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        return SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess ? out as? Data : nil
    }

    static func delete(_ service: String, _ account: String) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccount as String: account]
        SecItemDelete(q as CFDictionary)
    }
}

enum IdentityError: Error { case invalid(String), keychain }

// ── PC eşleşme kimliği (DeviceIdentityManager.kt ile birebir aynı imza metinleri) ──
final class DeviceIdentity {
    private let service = "com.jarvis.phone.identity"
    private let keyAccount = "aura.remote.device.identity.v1"
    private let counterAccount = "outbound_counter"
    private let lock = NSLock()

    static func b64(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    static func fromB64(_ s: String) -> Data? {
        var t = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while t.count % 4 != 0 { t += "=" }
        return Data(base64Encoded: t)
    }

    private func key() throws -> P256.Signing.PrivateKey {
        lock.lock(); defer { lock.unlock() }
        if let raw = Keychain.get(service, keyAccount) {
            return try P256.Signing.PrivateKey(rawRepresentation: raw)
        }
        let k = P256.Signing.PrivateKey()
        guard Keychain.set(service, keyAccount, k.rawRepresentation) else { throw IdentityError.keychain }
        return k
    }

    func info() throws -> (deviceId: String, publicKey: String, fingerprint: String) {
        let der = try key().publicKey.derRepresentation
        let hash = Data(SHA256.hash(data: der))
        let hex = hash.map { String(format: "%02x", $0) }.joined()
        return ("phone-" + String(hex.prefix(32)), Self.b64(der), "sha256:" + Self.b64(hash))
    }

    private func nextCounter() throws -> Int64 {
        lock.lock(); defer { lock.unlock() }
        var cur: Int64 = 0
        if let d = Keychain.get(service, counterAccount), let s = String(data: d, encoding: .utf8),
           let v = Int64(s) { cur = v }
        guard cur < Int64.max else { throw IdentityError.invalid("counter exhausted") }
        let next = cur + 1
        guard Keychain.set(service, counterAccount, Data(String(next).utf8)) else { throw IdentityError.keychain }
        return next
    }

    private func sign(_ material: String) throws -> String {
        Self.b64(try key().signature(for: Data(material.utf8)).derRepresentation)
    }

    private func safe(_ v: String, _ label: String, _ max: Int = 512) throws -> String {
        let c = v.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !c.isEmpty, c.count <= max, !c.contains("\n"), !c.contains("\r") else {
            throw IdentityError.invalid(label)
        }
        return c
    }

    func signAuth(_ a: AuthArgs) throws -> (String, Int64, String) {
        let id = try info()
        let host = try safe(a.hostId, "host id"), nonce = try safe(a.nonce, "nonce")
        let n = try nextCounter()
        return (id.deviceId, n, try sign("aura-auth-v1\n\(host)\n\(id.deviceId)\n\(nonce)\n\(n)"))
    }

    func signEnvelope(_ a: EnvelopeArgs) throws -> (String, Int64, String) {
        let id = try info()
        let nonce = try safe(a.connectionNonce, "nonce")
        let type = try safe(a.messageType, "type", 128)
        let task = a.taskId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard task.count <= 128, !task.contains("\n"), !task.contains("\r") else { throw IdentityError.invalid("task") }
        let digest = try safe(a.payloadDigest, "digest", 128)
        let n = try nextCounter()
        let m = "aura-envelope-v1\ndevice\n\(id.deviceId)\n\(nonce)\n\(n)\n\(type)\n\(task)\n\(digest)"
        return (id.deviceId, n, try sign(m))
    }

    func signPairing(_ a: PairingArgs) throws -> [String: Any] {
        let id = try info()
        let host = try safe(a.hostId, "host"), ch = try safe(a.challengeId, "challenge")
        let nonce = try safe(a.connectionNonce, "nonce")
        var name = a.deviceName.trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
        name = String(name.prefix(80))
        if name.isEmpty { name = "Aura phone" }
        let m = "aura-pair-v1\n\(host)\n\(ch)\n\(id.deviceId)\n\(nonce)\n\(id.publicKey)\n\(name)"
        return ["ok": true, "deviceId": id.deviceId, "publicKey": id.publicKey,
                "fingerprint": id.fingerprint, "deviceName": name, "signature": try sign(m)]
    }

    func verify(_ publicKey: String, _ fingerprint: String, _ material: String, _ signature: String) -> Bool {
        guard let der = Self.fromB64(publicKey), let sig = Self.fromB64(signature) else { return false }
        let actual = "sha256:" + Self.b64(Data(SHA256.hash(data: der)))
        guard actual == fingerprint.trimmingCharacters(in: .whitespacesAndNewlines),
              let key = try? P256.Signing.PublicKey(derRepresentation: der),
              let s = try? P256.Signing.ECDSASignature(derRepresentation: sig) else { return false }
        return key.isValidSignature(s, for: Data(material.utf8))
    }
}

// ── eklenti ─────────────────────────────────────────────────────────────────
class PhonePlugin: Plugin, AVSpeechSynthesizerDelegate {
    private let identity = DeviceIdentity()
    private let secretService = "com.jarvis.phone.secrets"
    private lazy var synth: AVSpeechSynthesizer = {
        let s = AVSpeechSynthesizer(); s.delegate = self; return s
    }()
    private var speaking = false

    private func result(_ ok: Bool, _ summary: String) -> [String: Any] { ["ok": ok, "summary": summary] }

    @objc public func isEnabled(_ invoke: Invoke) { invoke.resolve(["enabled": false]) }

    @objc public func speak(_ invoke: Invoke) {
        let text = ((try? invoke.parseArgs(SpeakArgs.self))?.text ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { invoke.resolve(result(true, "nothing to say")); return }
        DispatchQueue.main.async {
            // PC ile sesli görüşme sürerken ses oturumuna dokunma: "yalnız çalma" moduna geçmek
            // mikrofonu ve yankı engelini bozar; Apple sesi görüşmenin oturumundan çalar.
            if self.motor == nil {
                try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            }
            self.synth.stopSpeaking(at: .immediate)
            let u = AVSpeechUtterance(string: text)
            u.voice = AVSpeechSynthesisVoice(language: "tr-TR")
            self.speaking = true
            self.synth.speak(u)
        }
        invoke.resolve(result(true, "speaking"))
    }

    // ── PC ile sesli görüşme (yerel ses motoru) ──
    private var motor: SesMotoru?

    @objc public func voiceStart(_ invoke: Invoke) {
        let adres = ((try? invoke.parseArgs(VoiceStartArgs.self))?.url ?? "")
        guard let u = URL(string: adres), let sc = u.scheme?.lowercased(), sc == "ws" || sc == "wss" else {
            invoke.resolve(result(false, "Geçersiz ses adresi.")); return
        }
        DispatchQueue.main.async {
            self.motor?.durdur()
            self.motor = nil
            let m = SesMotoru()
            do {
                try m.baslat(u)
                self.motor = m
                invoke.resolve(self.result(true, "started"))
            } catch {
                m.durdur()
                invoke.resolve(self.result(false, "Ses başlatılamadı: \(error.localizedDescription)"))
            }
        }
    }

    @objc public func voiceStop(_ invoke: Invoke) {
        DispatchQueue.main.async {
            self.motor?.durdur()
            self.motor = nil
            invoke.resolve(self.result(true, "stopped"))
        }
    }

    @objc public func voicePoll(_ invoke: Invoke) {
        DispatchQueue.main.async {
            invoke.resolve(self.motor?.durum() ?? ["open": false, "closed": true])
        }
    }

    @objc public func stopSpeaking(_ invoke: Invoke) {
        DispatchQueue.main.async { self.synth.stopSpeaking(at: .immediate); self.speaking = false }
        invoke.resolve(result(true, "stopped"))
    }

    @objc public func pollSpeaking(_ invoke: Invoke) { invoke.resolve(["speaking": speaking]) }

    func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) { speaking = false }
    func speechSynthesizer(_ s: AVSpeechSynthesizer, didCancel u: AVSpeechUtterance) { speaking = false }

    @objc public func openUrl(_ invoke: Invoke) {
        var url = ((try? invoke.parseArgs(OpenUrlArgs.self))?.url ?? "").trimmingCharacters(in: .whitespaces)
        if url.isEmpty { invoke.resolve(result(false, "No URL given.")); return }
        if !url.contains("://") { url = "https://" + url }
        guard let u = URL(string: url), let sc = u.scheme?.lowercased(), sc == "https" || sc == "http" else {
            invoke.resolve(result(false, "I only open web links (http/https).")); return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(u) { ok in
                invoke.resolve(self.result(ok, ok ? "Opened \(url)." : "Couldn't open that link."))
            }
        }
    }

    @objc public func readClipboard(_ invoke: Invoke) {
        DispatchQueue.main.async {
            let t = (UIPasteboard.general.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            invoke.resolve(self.result(!t.isEmpty, t.isEmpty ? "Your clipboard is empty." : t))
        }
    }

    @objc public func getDeviceStats(_ invoke: Invoke) {
        DispatchQueue.main.async {
            let d = UIDevice.current
            d.isBatteryMonitoringEnabled = true
            var out: [String: Any] = [:]
            if d.batteryLevel >= 0 { out["batteryPct"] = Int((d.batteryLevel * 100).rounded()) }
            out["charging"] = d.batteryState == .charging || d.batteryState == .full
            invoke.resolve(out)
        }
    }

    // ── güvenli anahtar deposu ──
    @objc public func configSecretSet(_ invoke: Invoke) {
        guard let a = try? invoke.parseArgs(SecretSetArgs.self), !a.name.isEmpty,
              Keychain.set(secretService, a.name, Data(a.value.utf8)) else {
            invoke.resolve(result(false, "Credential could not be stored securely.")); return
        }
        invoke.resolve(result(true, "Credential stored securely."))
    }

    @objc public func configSecretGet(_ invoke: Invoke) {
        guard let a = try? invoke.parseArgs(SecretNameArgs.self), !a.name.isEmpty else {
            invoke.resolve(["ok": false, "present": false, "summary": "Credential could not be loaded securely."])
            return
        }
        if let d = Keychain.get(secretService, a.name), let v = String(data: d, encoding: .utf8) {
            invoke.resolve(["ok": true, "present": true, "value": v, "summary": "Credential loaded securely."])
        } else {
            invoke.resolve(["ok": true, "present": false, "summary": "Credential is not configured."])
        }
    }

    @objc public func configSecretDelete(_ invoke: Invoke) {
        if let a = try? invoke.parseArgs(SecretNameArgs.self), !a.name.isEmpty {
            Keychain.delete(secretService, a.name)
        }
        invoke.resolve(result(true, "Credential removed."))
    }

    // ── kimlik ──
    private func fail(_ s: String) -> [String: Any] { ["ok": false, "summary": s] }

    @objc public func identityInfo(_ invoke: Invoke) {
        guard let i = try? identity.info() else {
            invoke.resolve(fail("iOS Keychain identity is unavailable.")); return
        }
        invoke.resolve(["ok": true, "deviceId": i.deviceId, "publicKey": i.publicKey, "fingerprint": i.fingerprint])
    }

    @objc public func identitySignAuth(_ invoke: Invoke) {
        guard let a = try? invoke.parseArgs(AuthArgs.self), let s = try? identity.signAuth(a) else {
            invoke.resolve(fail("Could not sign the PC authentication challenge.")); return
        }
        invoke.resolve(["ok": true, "deviceId": s.0, "counter": s.1, "signature": s.2])
    }

    @objc public func identitySignEnvelope(_ invoke: Invoke) {
        guard let a = try? invoke.parseArgs(EnvelopeArgs.self), let s = try? identity.signEnvelope(a) else {
            invoke.resolve(fail("Could not sign the remote protocol envelope.")); return
        }
        invoke.resolve(["ok": true, "deviceId": s.0, "counter": s.1, "signature": s.2])
    }

    @objc public func identitySignPairing(_ invoke: Invoke) {
        guard let a = try? invoke.parseArgs(PairingArgs.self), let s = try? identity.signPairing(a) else {
            invoke.resolve(fail("Could not prove the phone identity for pairing.")); return
        }
        invoke.resolve(s)
    }

    @objc public func identityVerifyHostChallenge(_ invoke: Invoke) {
        var ok = false
        if let a = try? invoke.parseArgs(HostChallengeArgs.self) {
            let m = "aura-host-challenge-v1\n\(a.hostId)\n\(a.nonce)\n\(a.expiresAt)\n\(a.connectionId)"
            ok = identity.verify(a.publicKey, a.expectedFingerprint, m, a.signature)
        }
        invoke.resolve(["ok": ok, "verified": ok,
                        "summary": ok ? "Host identity verified." : "Host identity verification failed."])
    }

    @objc public func identityVerifyHostEnvelope(_ invoke: Invoke) {
        var ok = false
        if let a = try? invoke.parseArgs(HostEnvelopeArgs.self) {
            let m = "aura-envelope-v1\nhost\n\(a.hostId)\n\(a.connectionNonce)\n\(a.counter)\n\(a.messageType)\n\(a.taskId)\n\(a.payloadDigest)"
            ok = identity.verify(a.publicKey, a.expectedFingerprint, m, a.signature)
        }
        invoke.resolve(["ok": ok, "verified": ok,
                        "summary": ok ? "Host envelope verified." : "Host envelope verification failed."])
    }
}

@_cdecl("init_plugin_phone")
func initPlugin() -> Plugin {
    return PhonePlugin()
}
