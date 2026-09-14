# Webin — Privacy Policy

_Last updated: 15 September 2026_

Webin is a browser extension that changes how websites look. It has no account, no
server, and no analytics. It does not collect, transmit, sell, or share any data about
you.

## What Webin stores, and where

Everything Webin keeps is stored locally in your browser, using the browser's own
extension storage (`chrome.storage.local`) on your device:

- **Designs you have saved or imported** — the colours, fonts, spacing and other visual
  settings that make up each design, and, if you chose one, a background picture you
  selected from your own computer.
- **Which design is applied to which site** — the site's host name (for example
  `example.com`) paired with the design you chose for it.
- **Edits you have made by hand** — the styling changes you made to elements on a site,
  keyed by that site's host name.
- **Your panel preferences** — light or dark panel, which side it docks to, and whether
  readable-text rescue is on.

None of this leaves your device. It is not synced to any account, and Webin has no way to
read it back from anywhere but your own browser.

## What Webin reads from the pages you visit

To restyle a page, Webin reads that page's rendered styles — colours, spacing, corner
radii, fonts — and, when you pick an element to edit, that element's own styles and text
so the inspector can show what you are changing. This reading happens on your device and
is used only to restyle the page in front of you. Webin does not read form fields,
passwords, or browsing history, and it does not send any page content anywhere.

## Network use

Webin makes a network request in exactly one case: when you paste a web address into its
importer and ask it to fetch a design from there. That request goes to the address you
typed and carries none of your cookies or credentials. Nothing about you or the page you
are on is sent with it. Webin makes no other network requests of any kind.

## Sharing designs

If you copy a design's share code or export it to a file, that code or file contains only
the design itself — its colours, settings and any picture you added to it. It does not
contain the names of sites you use, your edits, or anything else about you. Sharing is
something you do by hand; Webin never publishes anything on your behalf.

## Permissions

- **Access to all websites** — needed so Webin can restyle whichever site you choose to
  open it on. On every page it checks its own local storage for a design you previously
  applied to that site and re-applies it; it shows nothing and changes nothing until you
  have used it there.
- **Storage** and **unlimited storage** — to keep your designs and edits on your device.
  Unlimited storage is requested because a design that includes a picture can exceed the
  default quota; it does not grant access to anything else.

## Deleting your data

Removing a design in Webin's panel deletes it. Resetting a site's edits deletes them.
Uninstalling the extension removes everything Webin stored.

## Changes to this policy

If Webin ever changes what it stores or where, this document will be updated and the
change noted in the extension's release notes. The current version of this policy is
always the one in the extension's source repository.

## Contact

Questions about this policy can be raised as an issue on the extension's source
repository.
