# Global "before" script (runs on LMTP delivery before the user's personal script).
# Rspamd (milter, docker/rspamd) marks spam for the "add header" / "rewrite subject" actions:
#   - "X-Spam: Yes" (proxy milter spam header),
#   - "X-Rspamd-Action: <action>" (milter_headers extended_spam_headers).
# Such mail is filed into Junk; the user's personal script is not run for it.
require ["fileinto", "mailbox"];

if anyof (header :is "X-Spam" "Yes",
          header :is "X-Spam-Flag" "YES",
          header :is "X-Rspamd-Action" ["add header", "rewrite subject"]) {
    fileinto :create "Junk";
    stop;
}
