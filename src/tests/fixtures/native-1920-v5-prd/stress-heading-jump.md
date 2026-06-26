# Platform Migration

### Why now

Legacy auth middleware fails compliance review for the upcoming SOC2 Type 2 audit. Continuing to defer this carries growing legal exposure quarter over quarter.

## Approach

We rip out the old middleware in a single sprint, replace it with the OIDC-native flow, and run a 2-week shadow window before cutover.

### Risks

- Session token migration during shadow window may double-count active users
- Mobile clients on app version <2.4 will need a forced refresh
