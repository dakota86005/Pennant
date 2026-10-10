/// How an event of the Staff room's answer stream (`POST /api/v2/staff-room/:org/ask`, D-074) reads for this build,
/// the way `ServerEventReading` reads the app's event stream: the generated `StaffRoomEvent` tries every shape and keeps
/// whatever decodes, so a newer server's event fills only the catch-all (`UnknownStaffRoomEvent`), and so does a known
/// event whose payload did not decode. This tells them apart:
/// - `known`: its own shape decoded (by its kind, never by its position in the union);
/// - `unknown`: a type this build has never heard of (ignore it; the stream goes on);
/// - `malformed`: a type this build knows whose payload did not decode (never read as unknown).
public enum StaffRoomEventReading: Sendable, Equatable {
    case known(Components.Schemas.StaffRoomEvent.Kind)
    case unknown(type: String)
    case malformed(type: String)
}

// One line per shape in the spec; `PennantAPITests` fails when the union has a shape not listed here.
extension Components.Schemas.StaffRoomStartedEvent: ServerEventShape {}
extension Components.Schemas.StaffRoomSpeakerEvent: ServerEventShape {}
extension Components.Schemas.StaffRoomLookingUpEvent: ServerEventShape {}
extension Components.Schemas.StaffRoomTextEvent: ServerEventShape {}
extension Components.Schemas.StaffRoomNoticeEvent: ServerEventShape {}
extension Components.Schemas.StaffRoomAnsweredEvent: ServerEventShape {}
extension Components.Schemas.StaffRoomDoneEvent: ServerEventShape {}
extension Components.Schemas.StaffRoomFailedEvent: ServerEventShape {}

extension Components.Schemas.StaffRoomEvent {
    /// A known event by its shape.
    public enum Kind: Sendable, Equatable {
        case started(Components.Schemas.StaffRoomStartedEvent)
        case speaker(Components.Schemas.StaffRoomSpeakerEvent)
        case lookingUp(Components.Schemas.StaffRoomLookingUpEvent)
        case text(Components.Schemas.StaffRoomTextEvent)
        case notice(Components.Schemas.StaffRoomNoticeEvent)
        case answered(Components.Schemas.StaffRoomAnsweredEvent)
        case done(Components.Schemas.StaffRoomDoneEvent)
        case failed(Components.Schemas.StaffRoomFailedEvent)

        /// The served `type` of each kind (the coverage test compares them with the generated shapes').
        public static var typeNames: [String] {
            [
                Components.Schemas.StaffRoomStartedEvent.typeNames, Components.Schemas.StaffRoomSpeakerEvent.typeNames,
                Components.Schemas.StaffRoomLookingUpEvent.typeNames, Components.Schemas.StaffRoomTextEvent.typeNames,
                Components.Schemas.StaffRoomNoticeEvent.typeNames, Components.Schemas.StaffRoomAnsweredEvent.typeNames,
                Components.Schemas.StaffRoomDoneEvent.typeNames, Components.Schemas.StaffRoomFailedEvent.typeNames,
            ].flatMap { $0 }
        }

        /// Whether the stream ends with this event (`done` or `failed`: exactly one comes, last).
        public var isTerminal: Bool {
            switch self {
            case .done, .failed: true
            default: false
            }
        }

        static func of(_ value: Any) -> Kind? {
            switch value {
            case let event as Components.Schemas.StaffRoomStartedEvent: .started(event)
            case let event as Components.Schemas.StaffRoomSpeakerEvent: .speaker(event)
            case let event as Components.Schemas.StaffRoomLookingUpEvent: .lookingUp(event)
            case let event as Components.Schemas.StaffRoomTextEvent: .text(event)
            case let event as Components.Schemas.StaffRoomNoticeEvent: .notice(event)
            case let event as Components.Schemas.StaffRoomAnsweredEvent: .answered(event)
            case let event as Components.Schemas.StaffRoomDoneEvent: .done(event)
            case let event as Components.Schemas.StaffRoomFailedEvent: .failed(event)
            default: nil
            }
        }
    }

    /// Every event type this build knows, from the generated shapes.
    public static var knownTypeNames: Set<String> {
        Set(Mirror(reflecting: Self()).children.flatMap { child in
            (type(of: child.value) as? any OptionalServerEventShape.Type)?.wrappedTypeNames ?? []
        })
    }

    /// The number of shapes in the generated union that are not the catch-all (for the coverage test).
    static var shapeCount: Int { Mirror(reflecting: Self()).children.count - 1 }

    /// The `type` the event carried, whatever else decoded.
    public var typeName: String? {
        Mirror(reflecting: self).children.lazy.compactMap { $0.value as? Components.Schemas.UnknownStaffRoomEvent }.first?._type
    }

    /// The event by its shape; nil when no known shape decoded.
    public var kind: Kind? {
        for child in Mirror(reflecting: self).children {
            if let kind = Kind.of(child.value) { return kind }
        }
        return nil
    }

    /// Known, unknown, or known but malformed.
    public var reading: StaffRoomEventReading {
        if let kind { return .known(kind) }
        let name = typeName ?? ""
        return Self.knownTypeNames.contains(name) ? .malformed(type: name) : .unknown(type: name)
    }
}
