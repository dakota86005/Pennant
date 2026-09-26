// An exported generic: the builder must refuse with the concrete-alias advice.
export interface Row<T> {
  id: string;
  item: T;
}
