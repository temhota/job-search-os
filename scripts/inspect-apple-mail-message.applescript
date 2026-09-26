-- Reads reply routing for one approved source message. It never changes or sends mail.
on run argv
  if (count of argv) is not 3 then error "Usage: inspect-apple-mail-message.applescript account mailbox message-id"
  set accountName to item 1 of argv
  set mailboxName to item 2 of argv
  set messageIdentifier to item 3 of argv
  set fieldSeparator to ASCII character 31

  tell application "Mail"
    set mailAccount to first account whose name is accountName
    set boxRef to mailbox mailboxName of mailAccount
    set matchingMessages to every message of boxRef whose message id is messageIdentifier
    if (count of matchingMessages) is 0 then error "Original message not found"
    set targetMessage to item 1 of matchingMessages
    set outputText to (reply to of targetMessage) as text
    set accountAddresses to get email addresses of mailAccount
  end tell

  repeat with accountAddress in accountAddresses
    set outputText to outputText & fieldSeparator & (accountAddress as text)
  end repeat
  return outputText
end run
