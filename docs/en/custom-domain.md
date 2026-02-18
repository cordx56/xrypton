# Setting Up a Custom Domain

In addition to setting up a distributed server, Xrypton offers a way to use your own domain.

## Add a TXT Record to DNS

To use a custom domain on a server, you first need to add a value to the TXT record of your domain.

First, decide on the server you want to join, `[host-domain]`, and the User ID you want to use, `[ID]@[your-domain]`.
Then, add the following TXT record to `_xrypton.[your-domain]` for your domain `[your-domain]`:

`"user=[ID]@[host-domain]"`

An important point: be sure to include the `"` characters in the TXT record value.

## Generate and Register a PGP Key

Once that's done, let's generate and register your PGP key.

First, access the server you want to join, `[host-domain]`, and open the registration screen.
In the "User ID" field on the key generation screen, enter `[ID]@[your-domain]`.

That's it! Easy, right?

## Troubleshooting

- "DNS mapping not found for this domain" is displayed on the registration screen
  - The TXT record format is incorrect. Once you make a mistake, the incorrect result will be cached for about an hour. Check your settings and try again after some time.
