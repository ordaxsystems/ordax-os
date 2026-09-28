# Identity capability lifecycle

`account.identity` and `sync.safe-state` are runtime capabilities owned by the live identity-session port. They are not boot-time feature flags.

The Surface may start while the configured account gateway is temporarily unreachable. In that state the identity session reports `unavailable`, so neither capability is advertised. When the existing connectivity recovery path refreshes the same session port and it becomes `signed-out` or `signed-in`, both capabilities become available through the existing Surface host subscription. If the session becomes unavailable again, both capabilities are withdrawn together.

The credential adapter is constructed with the composition because constructing it grants no identity, session, network reachability, or authority. A credential request still goes through the same-origin `/auth/login` or `/auth/register` route and fails normally when the real gateway is unavailable.

There is no provider fallback, fake provider, polling loop, boot-time cached authority, or separate Native/Web identity state machine. Native and Web consume the same identity-session contract and keep `sync.safe-state` inseparable from `account.identity`.
