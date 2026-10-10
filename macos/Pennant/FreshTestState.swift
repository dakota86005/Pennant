#if DEBUG
import Foundation
import Security

/// A UI test's first launch (`-PennantTestFreshDefaults YES`) starts from no saved windows: the app's saved state is
/// removed before any window is restored, wherever this macOS keeps it. Debug builds only; the GM's own saved windows
/// are never touched (a Release build has none of this, and a Debug build does it only when the tests ask).
///
/// Until macOS 15 the state was `~/Library/Saved Application State/<bundle id>.savedState`. On macOS 26 and 27 a
/// non-sandboxed app's state is kept by the system in a daemon's container instead,
/// `~/Library/Daemon Containers/<container>/Data/Library/Saved Application State/<UUID>.savedState`, its UUID found in
/// that folder's `ApplicationMapping.plist` by the app's code-signing identifier. The old path alone was empty at every
/// launch on the runner ("no saved windows were there"), so a player's window saved by one test (its frame, say the
/// narrow test's 520 × 480) was still there for the next test that restores windows.
enum FreshTestState {
    /// Removes the app's saved state; one line for the app's log saying what was found and removed.
    static func removeSavedWindows(bundleId: String) -> String {
        let library = FileManager.default.homeDirectoryForCurrentUser.appending(path: "Library", directoryHint: .isDirectory)
        var folders = [library.appending(path: "Saved Application State/\(bundleId).savedState", directoryHint: .isDirectory)]
        let identifiers = Set([bundleId, signingIdentifier()].compactMap { $0 })
        folders += daemonSavedStates(in: library, for: identifiers)
        var removed = 0
        var failures: [String] = []
        for folder in folders where FileManager.default.fileExists(atPath: folder.path(percentEncoded: false)) {
            do {
                try FileManager.default.removeItem(at: folder)
                removed += 1
            } catch {
                failures.append("\((error as NSError).domain) \((error as NSError).code)")
            }
        }
        let signed = identifiers.sorted().joined(separator: ", ")
        if !failures.isEmpty {
            return "launch: fresh test defaults; \(removed) saved-window folders removed, \(failures.count) could not be (\(failures.joined(separator: "; "))); signed as \(signed)"
        }
        return removed == 0
            ? "launch: fresh test defaults; no saved windows were there (signed as \(signed))"
            : "launch: fresh test defaults; the saved windows were removed (\(removed) folders; signed as \(signed))"
    }

    /// This process's code-signing identifier, as the system's mapping names the app (an unsigned test build's ad hoc
    /// signature may name it otherwise than its bundle id).
    private static func signingIdentifier() -> String? {
        var code: SecCode?
        guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { return nil }
        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { return nil }
        var info: CFDictionary?
        guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
              let info = info as? [String: Any] else { return nil }
        return info[kSecCodeInfoIdentifier as String] as? String
    }

    /// Each daemon container's saved state for these identifiers: its mapping is an array of pairs, a dictionary whose
    /// `protected.signingIdentifier` names an app, then the UUID string its folder is named by.
    private static func daemonSavedStates(in library: URL, for identifiers: Set<String>) -> [URL] {
        let containers = library.appending(path: "Daemon Containers", directoryHint: .isDirectory)
        let names = (try? FileManager.default.contentsOfDirectory(atPath: containers.path(percentEncoded: false))) ?? []
        var found: [URL] = []
        for name in names {
            let states = containers.appending(path: "\(name)/Data/Library/Saved Application State", directoryHint: .isDirectory)
            guard let data = try? Data(contentsOf: states.appending(path: "ApplicationMapping.plist")),
                  let mapping = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [Any] else { continue }
            for (index, entry) in mapping.enumerated() where index + 1 < mapping.count {
                guard let app = entry as? [String: Any], let uuid = mapping[index + 1] as? String,
                      let identifier = (app["protected"] as? [String: Any])?["signingIdentifier"] as? String,
                      identifiers.contains(identifier) else { continue }
                found.append(states.appending(path: "\(uuid).savedState", directoryHint: .isDirectory))
            }
        }
        return found
    }
}
#endif
