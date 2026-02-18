# Security

Xrypton places a strong emphasis on security.

## Signing and Encryption

Most data on Xrypton is signed, and data sent as messages is encrypted.
The table below shows which data is signed or encrypted.

| Data             | Security           |
|------------------|--------------------|
| Profile image    | Signed             |
| Name             | Signed             |
| Status           | Signed             |
| Bio              | Signed             |
| Channel name     | None               |
| Thread name      | None               |
| Updated at       | None               |
| Message          | Signed / Encrypted |
| Attachment       | Signed / Encrypted |
| File metadata    | Signed / Encrypted |

## Where Information Is Stored

Information is stored in the following locations.

| Data                    | Location            |
|-------------------------|---------------------|
| PGP public key          | Server / User device|
| PGP private key         | User device         |
| Profile information     | Server              |
| Encrypted messages      | Server              |
| Encrypted files         | Server              |
| AT Protocol credentials | User device         |

## Real-Time Session

For communication requiring an extremely high level of security, a real-time session can be used.

In a real-time session, users exchange encrypted connection-path information so they can communicate directly with each other.
Because communication does not go through the server, not even encrypted messages remain on the server.

In a real-time session, participating users generate one-time PGP keys for that session and use them to encrypt messages.
These keys are deleted from the device when the browser tab is closed or when the user leaves the session, and received messages can no longer be read.
