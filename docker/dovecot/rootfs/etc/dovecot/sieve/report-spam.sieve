# IMAPSieve: a message was moved/copied INTO Junk -> teach Rspamd "spam".
require ["vnd.dovecot.pipe", "copy", "imapsieve"];

pipe :copy "rspamd-learn" ["spam"];
