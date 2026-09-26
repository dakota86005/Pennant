import PennantKit
import SwiftUI

/// The scenes' ids, shared by the app and the views that open or close them.
public enum SceneID {
    public static let main = "main"
    public static let setup = "setup"
}

extension RequestProblem {
    /// What a window says: the server's own sentence, or a structural title for the kind. The raw detail is never
    /// shown as text (it is in the log and the help tag).
    public var title: Text {
        switch self {
        case .served(let sentence): Text(verbatim: sentence)
        case .notRunning: Text("The Pennant server isn't running")
        case .unreachable: Text("Couldn't reach the Pennant server")
        case .failed: Text("The request failed")
        }
    }
}

/// A line saying something went wrong: a warning symbol in red (so colour is not the only signal, and the text keeps
/// the primary colour's contrast) and the text, with the raw detail, when there is one, in the help tag.
public struct ProblemLine: View {
    private let text: Text
    private let detail: String?

    public init(_ problem: RequestProblem) {
        text = problem.title
        detail = problem.detail
    }

    /// A structural or served line with no detail.
    public init(_ text: Text) {
        self.text = text
        detail = nil
    }

    /// A served sentence, with the raw message behind it (when the server sent one) in the help tag.
    public init(served sentence: String, detail: String?) {
        text = Text(verbatim: sentence)
        self.detail = detail
    }

    public var body: some View {
        Label {
            text.foregroundStyle(.primary)
        } icon: {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
                .accessibilityHidden(true)
        }
        .help(detail: detail)
        .accessibilityIdentifier("problem")
    }
}

extension View {
    /// A help tag with raw or served text, when there is some.
    @ViewBuilder
    public func help(detail: String?) -> some View {
        if let detail, !detail.isEmpty { help(Text(verbatim: detail)) } else { self }
    }
}
