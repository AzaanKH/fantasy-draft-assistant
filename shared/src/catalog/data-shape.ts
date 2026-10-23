type KnownFields<A> = { [K in keyof A as string extends K ? never : K]: A[K] };

export type DataShape<A> = A extends readonly unknown[]
  ? { [K in keyof A]: DataShape<A[K]> }
  : A extends object
    ? keyof KnownFields<A> extends never
      ? A
      : { [K in keyof KnownFields<A>]: DataShape<KnownFields<A>[K]> }
    : A;
