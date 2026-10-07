// swift-tools-version:5.3
// DUNYATEK: tauri-plugin-phone'un iOS tarafı. Android'deki telefon kontrolünün çoğu
// (erişilebilirlik, SMS, başka uygulamayı yönetme) iOS'ta Apple tarafından yasak; burada
// yalnızca PC ile eşleşme kimliği, güvenli anahtar deposu ve basit komutlar var.
import PackageDescription

let package = Package(
    name: "tauri-plugin-phone",
    platforms: [
        .macOS(.v10_13),
        .iOS(.v14),
    ],
    products: [
        .library(name: "tauri-plugin-phone", type: .static, targets: ["tauri-plugin-phone"])
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api")
    ],
    targets: [
        .target(
            name: "tauri-plugin-phone",
            dependencies: [.byName(name: "Tauri")],
            path: "Sources")
    ]
)
