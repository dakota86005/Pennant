// The Keychain probe (N13, D-074): `KeychainItems.swift`, compiled with this file by `keychain-no-prompt.sh` on CI only,
// into copies signed differently, to show that reading or replacing another copy's item never shows a dialog. Never
// run on a Mac someone is using: the control step deliberately lets the system ask.
import Foundation
import Security

let arguments = CommandLine.arguments
guard arguments.count >= 3 else {
    print("usage: probe save|read|remove|read-allowing-dialog <service> [account] [secret]")
    exit(2)
}
let items = KeychainItems(service: arguments[2])
print("probe: the switch that forbids dialogs was \(KeychainItems.canForbidDialogs ? "found" : "NOT found")")

switch arguments[1] {
case "save" where arguments.count == 5:
    do {
        try items.save(arguments[4], account: arguments[3])
        print("saved")
    } catch {
        print("failed \(error.step) \(error.status)")
        exit(1)
    }
case "remove" where arguments.count == 4:
    do {
        try items.remove(account: arguments[3])
        print("removed")
    } catch {
        print("failed \(error.step) \(error.status)")
        exit(1)
    }
case "read":
    let contents = items.contents()
    print("readable: \(contents.readable.keys.sorted().joined(separator: ","))")
    print("unreadable: \(contents.unreadable.sorted().joined(separator: ","))")
case "read-allowing-dialog" where arguments.count == 4:
    // The control: the same read with the system free to ask (no switch, no context). A dialog here blocks until the
    // script's alarm ends it, which proves the steps above would have shown one without the switch.
    var data: CFTypeRef?
    let status = SecItemCopyMatching([
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: arguments[2],
        kSecAttrAccount as String: arguments[3],
        kSecReturnData as String: true,
    ] as CFDictionary, &data)
    print("status \(status)")
default:
    print("unknown command")
    exit(2)
}
