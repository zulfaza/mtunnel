import { AgentTokens } from "@tunnel/core";

export const mintAgentToken = AgentTokens.mint;
export const mintSignedToken = AgentTokens.mintSigned;
export const timingSafeSecretEqual = AgentTokens.timingSafeSecretEqual;
export const verifyAgentToken = AgentTokens.verify;
export type AgentClaims = AgentTokens.AgentClaims;
export type SignedClaims = AgentTokens.SignedClaims;
export type VerifyTokenResult = AgentTokens.VerifyTokenResult;
