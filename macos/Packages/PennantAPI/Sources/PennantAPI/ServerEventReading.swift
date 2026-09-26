/// How an event off `GET /api/v2/events` reads for this build of the app (SWIFTUI_REBUILD.md section 4.3).
///
/// The generated `ServerEvent` tries every event shape and keeps whatever decodes, so a newer server's event never
/// throws: it fills only the catch-all (`UnknownServerEvent`). The same happens to an event whose type this build
/// knows but whose payload did not decode (a field the build requires went missing, or changed type), and that must
/// never be read as "a new kind of event, ignore it". This tells the three apart:
/// - `known`: its own shape decoded; use it.
/// - `unknown`: a type this build has never heard of; ignore it.
/// - `malformed`: a type this build knows, whose payload did not decode; report it and re-read `/api/status`.
///
/// The known type names come from the generated types (each event's closed `type` tag), not from a list kept here.
public enum ServerEventReading: Sendable, Equatable {
    case known(Components.Schemas.ServerEvent)
    case unknown(type: String)
    case malformed(type: String)
}

/// An event shape the stream can carry: its `type` tag is a closed, one-value enum in the spec.
public protocol ServerEventShape: Sendable {
    associatedtype _TypePayload: CaseIterable, RawRepresentable where _TypePayload.RawValue == String
}

extension ServerEventShape {
    static var typeNames: [String] { _TypePayload.allCases.map(\.rawValue) }
}

// One line per event shape in the spec. `ServerEventReadingTests` fails if the generated `ServerEvent` has a shape
// that is not listed here, so a new event cannot be read as unknown by mistake.
extension Components.Schemas.HelloEvent: ServerEventShape {}
extension Components.Schemas.ImportStartedEvent: ServerEventShape {}
extension Components.Schemas.ImportProgressEvent: ServerEventShape {}
extension Components.Schemas.ImportFinishedEvent: ServerEventShape {}
extension Components.Schemas.ExportPendingEvent: ServerEventShape {}
extension Components.Schemas.JobEvent: ServerEventShape {}

/// Lets the reading find an event shape's names through the optional that holds it in `ServerEvent`.
protocol OptionalServerEventShape {
    static var wrappedTypeNames: [String] { get }
}

extension Optional: OptionalServerEventShape where Wrapped: ServerEventShape {
    static var wrappedTypeNames: [String] { Wrapped.typeNames }
}

extension Components.Schemas.ServerEvent {
    /// Every event type this build knows, from the generated event shapes.
    public static var knownTypeNames: Set<String> {
        Set(Mirror(reflecting: Self()).children.flatMap { child in
            (type(of: child.value) as? any OptionalServerEventShape.Type)?.wrappedTypeNames ?? []
        })
    }

    /// The number of event shapes in the generated union that are not the catch-all (for the coverage test).
    static var shapeCount: Int { Mirror(reflecting: Self()).children.count - 1 }

    /// The `type` the event carried, whatever else decoded.
    public var typeName: String? {
        Mirror(reflecting: self).children.lazy.compactMap { $0.value as? Components.Schemas.UnknownServerEvent }.first?._type
    }

    /// Known, unknown, or known but malformed.
    public var reading: ServerEventReading {
        let decodedShape = Mirror(reflecting: self).children.contains { $0.value is any ServerEventShape }
        if decodedShape { return .known(self) }
        let name = typeName ?? ""
        return Self.knownTypeNames.contains(name) ? .malformed(type: name) : .unknown(type: name)
    }
}
