# IMAPSieve: a message was moved/copied OUT of Junk -> teach Rspamd "ham",
# except when it is just being deleted (moved to Trash).
require ["vnd.dovecot.pipe", "copy", "imapsieve", "environment", "variables"];

if environment :matches "imap.mailbox" "*" {
    set "mailbox" "${1}";
}
if string "${mailbox}" "Trash" {
    stop;
}

pipe :copy "rspamd-learn" ["ham"];
