/**
 * Webmail v1 wire shapes. Everything that has a counterpart in the generated `@mgate/api-client`
 * schema is an alias of `components['schemas'][...]`, so the mail screens cannot drift from the
 * API contract. Only a few string-valued fields are narrowed here (folder role, preference enums)
 * because the schema documents them as plain strings.
 */
import type { components } from '@mgate/api-client';

type Schemas = components['schemas'];

export type FolderRole = 'inbox' | 'sent' | 'drafts' | 'spam' | 'trash' | 'archive' | (string & {});

/** Decoded full path in `name`; special folders are localized by `role`. */
export type FolderInfo = Omit<Schemas['FolderInfo'], 'role'> & { role: FolderRole };

export type MessageSummary = Schemas['MessageSummary'];
export type MessageList = Schemas['MessageListResponse'];
export type AttachmentInfo = Schemas['AttachmentInfoWrapper'];
export type AuthSummary = Schemas['AuthSummary'];
/** `too_large` is true when the message exceeded the server render limit: only headers are returned. */
export type MessageDetail = Schemas['MessageDetail'];
export type ThreadDetail = Schemas['ThreadDetail'];
export type MailLimits = Schemas['LimitsResponse'];
export type StagedAttachment = Schemas['AttachmentUploadResponse'];
export type DraftItem = Schemas['DraftItem'];
export type SaveDraftRequest = Schemas['SaveDraftRequest'];
/** `forward_attachments` is the list of original attachment indexes to carry into a forward. */
export type SendRequest = Schemas['SendMessageRequest'];
/** `saved_to_sent` is false when the message went out but the copy in "Sent" could not be stored. */
export type SendResponse = Schemas['SendMessageResponse'];

export type RemoteImagesPolicy = 'ask' | 'always' | 'never';
export type ListDensity = 'compact' | 'normal' | 'comfortable';

export type WebmailPrefsWire = Schemas['WebmailPreferences'];

/** Preferences with server-side gaps filled in (`useMailPrefs` normalises the raw response). */
export type WebmailPrefs = Omit<
  Schemas['WebmailPreferences'],
  'remote_images' | 'list_density' | 'mark_read_on_open'
> & {
  remote_images: RemoteImagesPolicy;
  list_density: ListDensity;
  mark_read_on_open: boolean;
};

export type Signature = Schemas['WebmailSignatureItem'];
export type SignatureInput = Schemas['SignatureRequest'];
export type Contact = Schemas['ContactItem'];
/** `null` on an optional field clears it. */
export type ContactInput = Schemas['CreateContactRequest'];
export type ContactGroup = Schemas['ContactGroupItem'];
export type ImportResult = Schemas['ImportContactsResponse'];
