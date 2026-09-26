/**
 * Primitive types the contract names (D-056). Server modules use them on the fields the contract describes, so the spec
 * says exactly what is sent; at run time each is the plain TypeScript type.
 */

/**
 * A whole number: an id, a count, a season, a number of days. The spec says `type: integer`, so the Mac app reads an
 * `Int`, not a `Double`. A true decimal (a rate, a slider, dollars) stays `number`. Named `Integer`, never `Int`,
 * which the Swift generator would rename.
 *
 * @asType integer
 */
export type Integer = number;
