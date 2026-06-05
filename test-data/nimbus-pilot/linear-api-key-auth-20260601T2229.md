# Linear API-key authentication test fixture

This draft PR represents the implementation evidence for the Linear retrieval failure.

Implementation notes:
- Linear API keys must be passed as the raw Authorization header value.
- The runtime error explicitly rejects `Bearer <api key>` for Linear API-key credentials.
- Integration status should be credential-backed and must not mark GitHub or Linear connected by default.
- OAuth redirect URLs should derive from the request host rather than assuming localhost.

Review focus:
- Confirm existing API-key users are not forced through OAuth.
- Add regression coverage for Linear search header construction.
- Verify no credential value is logged during failed retrieval.

Linear: MUR-11
Notion: https://www.notion.so/TEST-DATA-Nimbus-pilot-Friday-stakeholder-update-372da49acbb281219594e2d558e47139
