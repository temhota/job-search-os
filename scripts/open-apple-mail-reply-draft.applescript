-- Opens a native reply for review. The dashboard copies the follow-up text separately. This script never sends a message.
on run argv
  if (count of argv) is not 5 then error "Usage: open-apple-mail-reply-draft.applescript account mailbox message-id recipient sender"
  set accountName to item 1 of argv
  set mailboxName to item 2 of argv
  set messageIdentifier to item 3 of argv
  set recipientAddress to item 4 of argv
  set senderAddress to item 5 of argv

  tell application "Mail"
    set mailAccount to first account whose name is accountName
    set boxRef to mailbox mailboxName of mailAccount
    set matchingMessages to every message of boxRef whose message id is messageIdentifier
    if (count of matchingMessages) is 0 then error "Original message not found"
    set targetMessage to item 1 of matchingMessages
    if quote original message is false then error "Apple Mail is configured not to quote original messages"
    set draftMessage to reply targetMessage opening window false reply to all false
    set sender of draftMessage to senderAddress
    if (count of to recipients of draftMessage) is 0 then error "Native reply has no recipient"
    set actualRecipient to address of first to recipient of draftMessage
    if actualRecipient is not equal to recipientAddress then error "Native reply recipient does not match the inspected Reply-To"
    set visible of draftMessage to true
    activate
  end tell
end run
