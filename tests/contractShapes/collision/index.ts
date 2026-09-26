// Two different types named `Info`, reached from two exports: the builder must refuse.
export type { UsesA } from './a.js';
export type { UsesB } from './b.js';
