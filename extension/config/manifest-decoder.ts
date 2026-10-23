import { Schema } from 'effect';

const manifest = Schema.StructWithRest(Schema.Struct({
  host_permissions: Schema.Array(Schema.String),
  content_security_policy: Schema.StructWithRest(Schema.Struct({ extension_pages: Schema.String }), [Schema.Record(Schema.String, Schema.Unknown)]),
}), [Schema.Record(Schema.String, Schema.Unknown)]);

export const decodeExtensionManifest = Schema.decodeUnknownSync(manifest);
