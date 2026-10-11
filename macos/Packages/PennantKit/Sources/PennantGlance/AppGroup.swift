import Foundation
import Security

/// The App Group the app and its widget share (SWIFTUI_REBUILD.md section 6; D-075): `<TEAMID>.group.com.dakotawise.pennant`
/// for the release app, `….pennant.dev` for a development build, so a development build never writes the release
/// widget's glance. The Team-ID prefix is what macOS 15 and later accept without asking the person whether the app may
/// reach another app's data.
///
/// Its identifier is in each bundle's Info.plist (`PennantAppGroup`, from the `PENNANT_APP_GROUP` build setting). The
/// container is used only when this process's signature carries the group (`com.apple.security.application-groups`):
/// an unsigned build (CI's) or one signed without it gets no container, writes no glance, and never touches a group
/// folder, so the system has nothing to ask about.
public enum AppGroup {
    /// The Info.plist key holding the group's identifier.
    public static let infoKey = "PennantAppGroup"
    /// The entitlement that lists the groups a signed process may use.
    public static let entitlement = "com.apple.security.application-groups"

    /// The group named in the bundle's Info.plist; nil when it names none, or names a build setting left unexpanded.
    public static func identifier(in bundle: Bundle) -> String? {
        identifier(from: bundle.object(forInfoDictionaryKey: infoKey) as? String)
    }

    /// The group in an Info.plist value: a real identifier, never empty or a `$(…)` left unexpanded.
    public static func identifier(from value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespaces), !value.isEmpty, !value.contains("$(") else { return nil }
        return value
    }

    /// The groups this process's signature carries; empty when it carries none (an unsigned or ad hoc signed build).
    public static func entitledGroups() -> [String] {
        guard let task = SecTaskCreateFromSelf(nil),
              let value = SecTaskCopyValueForEntitlement(task, entitlement as CFString, nil) else { return [] }
        return (value as? [String]) ?? []
    }

    /// The group's container, only when the group is named and this process is entitled to it; nil otherwise.
    public static func container(identifier: String?, entitled: [String] = entitledGroups()) -> URL? {
        guard let identifier, entitled.contains(identifier) else { return nil }
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier)
    }

    /// Where the glance is kept for this bundle: the group's container when it can be reached, else none.
    public static func glanceStore(bundle: Bundle = .main) -> GlanceSnapshotStore {
        GlanceSnapshotStore(folder: container(identifier: identifier(in: bundle)))
    }
}
