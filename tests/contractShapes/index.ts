/**
 * A small contract of shapes the real one will need but does not have yet (SWIFTUI_REBUILD.md section 4.1), built by the
 * same pipeline (`npm run contract:build` writes it to the Swift package's `ContractShapesTests`) so the generated Swift
 * is proven to decode them before a department depends on them. Nothing here is served.
 */
import type { Integer } from '../../server/contract/primitives.js';

/** A table row's sort keys, as `Row.sort` will carry them: a number, a string, or unknown (null). */
export interface SortKeys {
  sort: Record<string, number | string | null>;
}

/** A field that is a number or a string, with and without null. */
export interface Mixed {
  either: number | string;
  eitherOrNull: number | string | null;
}

/** A whole number and a nullable one. */
export interface Counted {
  id: Integer;
  count: Integer | null;
}

/** A generic is never exported; a concrete alias of it is, and becomes one named component. */
interface Row<T> {
  id: string;
  item: T;
}
export type CountedRow = Row<Counted>;
