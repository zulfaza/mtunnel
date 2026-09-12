import { PreviewAccess, Schemas } from "@tunnel/core";

export const ACCESS_CODE_MAXIMUM_LENGTH = PreviewAccess.ACCESS_CODE_MAXIMUM_LENGTH;
export const ACCESS_CODE_MINIMUM_LENGTH = PreviewAccess.ACCESS_CODE_MINIMUM_LENGTH;
export const DOCUMENT_ACCESS_GRANT_TTL_MS = PreviewAccess.DOCUMENT_ACCESS_GRANT_TTL_MS;
export const PREVIEW_ACCESS_SESSION_COOKIE = PreviewAccess.PREVIEW_ACCESS_SESSION_COOKIE;
export const accessCodeFingerprint = PreviewAccess.accessCodeFingerprint;
export const accessSessionHash = PreviewAccess.accessSessionHash;
export const accessSessionToken = PreviewAccess.accessSessionToken;
export const cookieValue = PreviewAccess.cookieValue;
export const hashAccessCode = PreviewAccess.hashAccessCode;
export const isAccessCode = PreviewAccess.isAccessCode;
export const isPreviewVisibility = PreviewAccess.isPreviewVisibility;
export const previewAccessCookieName = PreviewAccess.previewAccessCookieName;
export const previewAccessCookieValue = PreviewAccess.previewAccessCookieValue;
export const verifyAccessCode = PreviewAccess.verifyAccessCode;
export const verifyPreviewOwnerTicket = PreviewAccess.verifyPreviewOwnerTicket;
export type PreviewVisibility = Schemas.PreviewVisibility;
