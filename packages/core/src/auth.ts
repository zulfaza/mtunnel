import { Context, Effect, Layer } from "effect";
import { CoreConfig } from "./config.js";
import { ForbiddenError, OrganizationUnavailableError, UnauthorizedError } from "./errors.js";
import { Organizations } from "./organizations.js";
import { timingSafeSecretEqual } from "./agent-tokens.js";
import { Workos } from "./workos.js";

export interface AuthenticationInput {
  readonly bearer: string | null;
  readonly organizationId: string | null;
}

export interface CurrentUserValue {
  readonly userId: string;
  readonly organizationId: string;
}

export class CurrentUser extends Context.Service<CurrentUser, CurrentUserValue>()(
  "@tunnel/core/auth/CurrentUser",
) {}

export class Authentication extends Context.Service<
  Authentication,
  {
    readonly authenticate: (
      input: AuthenticationInput,
    ) => Effect.Effect<
      CurrentUserValue,
      UnauthorizedError | ForbiddenError | OrganizationUnavailableError
    >;
  }
>()("@tunnel/core/auth/Authentication") {}

export const authenticationLayer = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const config = yield* CoreConfig;
    const workos = yield* Workos;
    const organizations = yield* Organizations;
    const authenticate = Effect.fn("auth.authenticate")(function* (input: AuthenticationInput) {
      if (input.bearer === null) return yield* Effect.fail(new UnauthorizedError({}));
      if (
        config.authMode === "development" &&
        config.devAuthSecret !== undefined &&
        timingSafeSecretEqual(input.bearer, config.devAuthSecret)
      )
        return { userId: "development-user", organizationId: "development-organization" };
      const userId = yield* workos.verifyAccessToken(input.bearer);
      if (userId === null) return yield* Effect.fail(new UnauthorizedError({}));
      const organizationId = yield* Effect.catchTags(
        input.organizationId === null
          ? organizations.ensureForUser(userId)
          : organizations.forMember(userId, input.organizationId),
        {
          WorkosRequestError: () => Effect.fail(new OrganizationUnavailableError({})),
        },
      );
      if (organizationId === null) return yield* Effect.fail(new ForbiddenError({}));
      return { userId, organizationId };
    });
    return Authentication.of({ authenticate });
  }),
);
