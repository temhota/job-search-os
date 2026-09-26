-- Read-only verification snapshot. Outputs no message content and mutates nothing.
on run argv
  if (count of argv) < 3 then error "Usage: snapshot-apple-mail-state.applescript YYYY-MM-DD YYYY-MM-DD account..."
  set cutoffDate to my isoDate(item 1 of argv)
  set endDate to my isoDate(item 2 of argv)
  set accountNames to items 3 thru -1 of argv
  set fieldSeparator to ASCII character 31
  set recordSeparator to ASCII character 30
  set outputText to ""

  tell application "Mail"
    repeat with accountName in accountNames
      try
        set mailAccount to first account whose name is (accountName as text)
        repeat with mailboxName in {"INBOX", "Gesendet", "Sent", "Sent Mail", "Gesendete Elemente"}
          try
            set boxRef to mailbox (mailboxName as text) of mailAccount
            set messageIndex to 1
            set batchSize to 100
            set boxDone to false
            repeat until boxDone
              set batchEnd to messageIndex + batchSize - 1
              set batchMessages to {}
              try
                set batchMessages to messages messageIndex thru batchEnd of boxRef
              on error
                repeat with singleIndex from messageIndex to batchEnd
                  try
                    set end of batchMessages to message singleIndex of boxRef
                  on error
                    set boxDone to true
                    exit repeat
                  end try
                end repeat
              end try
              if (count of batchMessages) is 0 then exit repeat
              repeat with mailMessage in batchMessages
                set messageDate to date received of mailMessage
                if messageDate < cutoffDate then
                  set boxDone to true
                  exit repeat
                end if
                if messageDate < endDate then
                  set messageSubject to my safeText(subject of mailMessage)
                  set messageSender to my safeText(sender of mailMessage)
                  if my isCandidate(messageSubject, messageSender) then
                    set messageIdentifier to my safeText(message id of mailMessage)
                    if messageIdentifier is "" then set messageIdentifier to (accountName as text) & ":" & mailboxName & ":" & (id of mailMessage as text)
                    set outputText to outputText & messageIdentifier & fieldSeparator & my safeText(accountName as text) & fieldSeparator & my safeText(mailboxName) & fieldSeparator & my safeText(read status of mailMessage as text) & fieldSeparator & my safeText(flagged status of mailMessage as text) & recordSeparator
                  end if
                end if
              end repeat
              set messageIndex to messageIndex + (count of batchMessages)
              if (count of batchMessages) < batchSize then set boxDone to true
            end repeat
          end try
        end repeat
      end try
    end repeat
  end tell
  return outputText
end run

on isoDate(value)
  set resultDate to current date
  set year of resultDate to text 1 thru 4 of value as integer
  set month of resultDate to text 6 thru 7 of value as integer
  set day of resultDate to text 9 thru 10 of value as integer
  set time of resultDate to 0
  return resultDate
end isoDate

on isCandidate(subjectText, senderText)
  set haystack to subjectText & " " & senderText
  set terms to {"application", "bewerbung", "interview", "gespräch", "recruit", "talent acquisition", "candidate", "coding challenge", "coding task", "take-home", "offer", "absage", "rejection", "job", "position", "role", "greenhouse", "lever.co", "ashbyhq", "personio", "workable", "smartrecruiters", "teamtailor", "recruitee"}
  ignoring case
    repeat with termText in terms
      if haystack contains (termText as text) then return true
    end repeat
  end ignoring
  return false
end isCandidate

on safeText(value)
  if value is missing value then return ""
  set cleanText to value as text
  set cleanText to my replaceText(cleanText, ASCII character 31, " ")
  set cleanText to my replaceText(cleanText, ASCII character 30, " ")
  return cleanText
end safeText

on replaceText(sourceText, findText, replacementText)
  set AppleScript's text item delimiters to findText
  set parts to text items of sourceText
  set AppleScript's text item delimiters to replacementText
  set resultText to parts as text
  set AppleScript's text item delimiters to ""
  return resultText
end replaceText
