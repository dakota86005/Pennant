import PennantKit
import SwiftUI

extension EnvironmentValues {
    /// What the window's view opens on (`AppRoute.subject`, N10): a player's id on Farm & Development ▸ Decision, an
    /// affiliate's team id on Affiliates. Nil for the view itself. Set by the window for the view it hosts.
    @Entry public var routeSubject: String? = nil
}

extension AppRoute {
    /// The subject as a served id (a player's or a club's), when it is one.
    public var subjectID: Int? { subject.flatMap(Int.init) }
}
