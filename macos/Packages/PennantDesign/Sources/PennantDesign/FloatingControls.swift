import SwiftUI

/// A view's one floating control group (SWIFTUI_REBUILD.md section 3.7): capsule glass controls over the content, in a
/// `GlassEffectContainer` so neighbours blend and morph (`glassEffectID`). Glass belongs to the controls layer only, and
/// a view has at most one such group, for a real primary action it has.
///
/// The system's glass follows Reduce Transparency and Increase Contrast itself; with Reduce Transparency on, the app's
/// controls are drawn opaque (the system's control fill, or the theme's tint) with a border.
public struct FloatingControlGroup<Content: View>: View {
    @Namespace private var namespace
    private let content: (Namespace.ID) -> Content

    public init(@ViewBuilder content: @escaping (Namespace.ID) -> Content) {
        self.content = content
    }

    public var body: some View {
        GlassEffectContainer(spacing: 12) {
            HStack(spacing: 12) {
                content(namespace)
            }
        }
    }
}

/// One control in a floating group: a label and symbol (structural, from the String Catalog) and its action, drawn with
/// the system's glass button styles. The prominent one is the system's prominent glass in the theme's tint, with the
/// tint's own text colour, which the server checked against it.
public struct FloatingControl: View {
    private let title: LocalizedStringKey
    private let systemImage: String
    private let prominent: Bool
    private let id: String
    private let namespace: Namespace.ID
    private let action: () -> Void
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast
    @EffectiveReduceTransparency private var reduceTransparency
    @Environment(\.appearsActive) private var appearsActive

    public init(
        _ title: LocalizedStringKey,
        systemImage: String,
        prominent: Bool = false,
        id: String,
        in namespace: Namespace.ID,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.systemImage = systemImage
        self.prominent = prominent
        self.id = id
        self.namespace = namespace
        self.action = action
    }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        if reduceTransparency {
            // Opaque, as the system draws its own controls with Reduce Transparency on
            Button(action: action) {
                Label(title, systemImage: systemImage)
                    .font(.body.weight(.medium))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 9)
                    .contentShape(.capsule)
            }
            .buttonStyle(.plain)
            .foregroundStyle(prominent ? palette.tintText : Color(nsColor: .labelColor))
            .background(prominent ? palette.tint : Color(nsColor: .controlBackgroundColor), in: .capsule)
            .overlay {
                Capsule().strokeBorder(Color(nsColor: .separatorColor), lineWidth: contrast == .increased ? 1.5 : 0.5)
            }
        } else if prominent {
            // The system's prominent glass, in the club's tint, with the tint's own text colour: the tint is held opaque
            // enough by the system that its text reads whatever scrolls behind (the server checked the pair)
            Button(action: action) {
                // The tint's text colour set on the label itself (the style would write white on any tint); in a window
                // in the background the system draws the control untinted, and its label in the label colour
                Label(title, systemImage: systemImage)
                    .font(.body.weight(.medium))
                    .foregroundStyle(appearsActive ? palette.tintText : Color(nsColor: .labelColor))
            }
            .buttonStyle(.glassProminent)
            .tint(palette.tint)
            .controlSize(.large)
            .glassEffectID(id, in: namespace)
        } else {
            Button(action: action) {
                Label(title, systemImage: systemImage).font(.body.weight(.medium))
            }
            .buttonStyle(.glass)
            .controlSize(.large)
            .glassEffectID(id, in: namespace)
        }
    }
}
