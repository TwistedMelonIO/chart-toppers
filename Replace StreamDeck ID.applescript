-- Replace StreamDeck ID in QLab 5
-- Twisted Melon — Chart Toppers
-- Run this as a Script cue inside QLab.

script helpers
	on processGroup(theGroup, newTag, updateCount)
		tell application id "com.figure53.QLab.5" to tell front workspace
			set theCues to cues of theGroup
			repeat with theCue in theCues
				set cueType to q type of theCue
				if cueType is "Group" then
					set updateCount to my processGroup(theCue, newTag, updateCount)
				else if cueType is "Network" then
					set oldMsg to custom message of theCue
					set newMsg to my replaceStreamDeckID(oldMsg, newTag)
					if newMsg is not oldMsg then
						set custom message of theCue to newMsg
						set updateCount to updateCount + 1
					end if
				end if
			end repeat
		end tell
		return updateCount
	end processGroup

	on replaceStreamDeckID(theText, newTag)
		set theLength to count of characters of theText
		set searchFor to "streamdeck:"
		set searchLen to count of characters of searchFor
		set outText to ""
		set i to 1
		repeat while i ≤ theLength
			if i + searchLen - 1 ≤ theLength then
				set chunk to text i thru (i + searchLen - 1) of theText
			else
				set chunk to ""
			end if
			if chunk is searchFor then
				set outText to outText & newTag
				set i to i + searchLen
				repeat while i ≤ theLength
					set c to character i of theText
					if c is in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_" then
						set i to i + 1
					else
						exit repeat
					end if
				end repeat
			else
				set outText to outText & character i of theText
				set i to i + 1
			end if
		end repeat
		return outText
	end replaceStreamDeckID
end script

set newID to text returned of (display dialog ¬
	"Enter the new Stream Deck serial number:" & return & return & ¬
	"(Just the serial — e.g. A00SA5452KMUPB)" default answer "" ¬
	with title "Replace Stream Deck ID" buttons {"Cancel", "Replace"} default button "Replace")

if newID is "" then
	display dialog "No serial entered. Nothing changed." buttons {"OK"} default button "OK"
	return
end if

set newTag to "streamdeck:" & newID

tell application id "com.figure53.QLab.5" to tell front workspace
	set theGroup to first cue whose q name is "StreamDeck"
end tell

set updateCount to helpers's processGroup(theGroup, newTag, 0)

display dialog "Done — updated " & updateCount & " Network cue(s)." buttons {"OK"} default button "OK" with title "Replace Stream Deck ID"
