/**
 * What the site and its API (server/) say to each other about accounts,
 * models kept online and the gallery: the limits both keep, and the shape of
 * every request and response, checked on both sides.
 */
import { z } from 'zod';

/** Ways to sign in. `test` needs no provider, and only a test server on this computer offers it. */
export const PROVIDERS = ['github', 'google', 'test'] as const;
export type Provider = (typeof PROVIDERS)[number];

/** As long as the model name field takes. */
export const MAX_MODEL_NAME = 120;
/** As many as a model file may hold (MAX_BRICKS in ../io/modelFile, which the server leaves out). */
export const MAX_BRICKS = 50_000;
export const MAX_DISPLAY_NAME = 40;
/**
 * A model online is its file, deflated, in base64url: about 1 MB packed,
 * room enough for the 50,000 bricks a model may hold.
 */
export const MAX_MODEL_DATA = 1_400_000;
/** A thumbnail is a JPEG in base64url: about 150 kB. */
export const MAX_THUMBNAIL = 200_000;
export const MAX_MODELS_PER_ACCOUNT = 100;
/** What an account's models online may take up, files and pictures together: about 25 MB. */
export const MAX_ACCOUNT_BYTES = 25_000_000;
export const GALLERY_PAGE_SIZE = 24;
export const MAX_SEARCH = 60;
export const MAX_REPORT_NOTE = 300;
export const REPORT_REASONS = ['offensive', 'spam', 'copied', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Ids of accounts and models: 16 letters and digits, which make 80 random bits. */
export const ID_PATTERN = /^[0-9a-z]{16}$/;
const BASE64URL = /^[A-Za-z0-9_-]*$/;
/** Control characters, and the ones that turn text around, which could disguise one name as another. */
const UNSAFE_CHARACTERS = /[\p{Cc}\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
/** Characters that show nothing: a name of them alone would look blank. */
const INVISIBLE_CHARACTERS = /[\u00ad\u034f\u115f\u1160\u17b4\u17b5\u180e\u200b\u2060\u2800\u3164\ufeff\uffa0]/gu;
/** Something that shows: anything but spaces and the joiners that hold emoji together. */
const VISIBLE = /[^\s\u200c\u200d]/u;

/**
 * A name as shown: no control or invisible characters, spaces closed up, at
 * most `max` characters; empty when nothing that shows is left.
 */
export function cleanName(text: string, max: number): string {
  const cleaned = text.replace(UNSAFE_CHARACTERS, ' ').replace(INVISIBLE_CHARACTERS, '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return VISIBLE.test(cleaned) ? cleaned : '';
}

const id = z.string().regex(ID_PATTERN);
const name = (max: number) =>
  z
    .string()
    .max(max * 4)
    .transform((text) => cleanName(text, max))
    .refine((text) => text.length > 0, 'a name cannot be empty');
const time = z.number().int().nonnegative();

export const userSchema = z.object({
  id,
  name: z.string(),
  /** May hide models from the gallery and stop accounts publishing. */
  admin: z.boolean(),
  /** Stopped from saving, publishing and reporting by a moderator. */
  banned: z.boolean(),
});
export type User = z.infer<typeof userSchema>;

export const sessionSchema = z.object({
  /** Null when signed out. */
  user: userSchema.nullable(),
  /** The ways in this site offers. */
  providers: z.array(z.enum(PROVIDERS)),
});
export type Session = z.infer<typeof sessionSchema>;

export const modelInfoSchema = z.object({
  id,
  name: z.string(),
  bricks: z.number().int().nonnegative(),
  /** Counts saves; a save must name the revision it follows on from. */
  revision: z.number().int().positive(),
  /** What it takes up online, file and picture, in bytes. */
  size: z.number().int().nonnegative(),
  createdAt: time,
  updatedAt: time,
  /** When it went into the gallery; null while it is private. */
  publishedAt: time.nullable(),
  /** Taken out of the gallery by a moderator. */
  hidden: z.boolean(),
  hasThumbnail: z.boolean(),
  owner: z.object({ id, name: z.string() }),
});
export type ModelInfo = z.infer<typeof modelInfoSchema>;

/** A model with its file: deflated and in base64url. */
export const modelWithDataSchema = z.object({ model: modelInfoSchema, data: z.string() });
export type ModelWithData = z.infer<typeof modelWithDataSchema>;

export const modelListSchema = z.object({ models: z.array(modelInfoSchema) });

export const galleryPageSchema = z.object({
  models: z.array(modelInfoSchema),
  /** Asks for the page after this one; null on the last. */
  next: z.string().nullable(),
});
export type GalleryPage = z.infer<typeof galleryPageSchema>;

export const reportedModelSchema = z.object({
  model: modelInfoSchema,
  /** Whether its owner is already stopped from saving, publishing and reporting. */
  ownerBanned: z.boolean(),
  count: z.number().int().positive(),
  reasons: z.partialRecord(z.enum(REPORT_REASONS), z.number().int().positive()),
  notes: z.array(z.string()),
  latestAt: time,
});
export type ReportedModel = z.infer<typeof reportedModelSchema>;
export const reportListSchema = z.object({ reports: z.array(reportedModelSchema) });

/** Accounts a moderator has stopped saving, publishing and reporting. */
export const stoppedAccountsSchema = z.object({ users: z.array(z.object({ id, name: z.string() })) });
export type StoppedAccount = z.infer<typeof stoppedAccountsSchema>['users'][number];

export const errorSchema = z.object({ error: z.string() });

// requests

export const saveRequestSchema = z.object({
  name: name(MAX_MODEL_NAME),
  bricks: z.number().int().min(0).max(MAX_BRICKS),
  data: z.string().min(1).max(MAX_MODEL_DATA).regex(BASE64URL),
  thumbnail: z.string().min(1).max(MAX_THUMBNAIL).regex(BASE64URL).nullable(),
  /** For a save over a model kept online: the revision this copy follows on from. */
  revision: z.number().int().positive().optional(),
});
export type SaveRequest = z.input<typeof saveRequestSchema>;

/** Into the gallery, or out of it. A model's name comes with its saves, from the model itself. */
export const modelChangeSchema = z.object({ published: z.boolean() });
export type ModelChange = z.input<typeof modelChangeSchema>;

export const accountChangeSchema = z.object({ name: name(MAX_DISPLAY_NAME) });

export const reportRequestSchema = z.object({
  reason: z.enum(REPORT_REASONS),
  note: z.string().max(MAX_REPORT_NOTE).default(''),
});

export const moderateModelSchema = z
  .object({
    /** Out of the gallery, or back in. Either way the model's reports are settled. */
    hidden: z.boolean().optional(),
    /** Settles the reports and leaves the model as it is. */
    dismiss: z.literal(true).optional(),
  })
  .refine((action) => action.hidden !== undefined || action.dismiss !== undefined, 'nothing to do');

export const moderateUserSchema = z.object({ banned: z.boolean() });
