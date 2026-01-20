#!/usr/bin/env bash
set -euo pipefail
# Rotate AWS IAM keys for a given IAM username.
# Requires: `aws` CLI configured with permissions to create/delete access keys.

usage(){
  cat <<EOF
Usage: $0 <iam-username>

Creates a new access key for the IAM user, prints it to stdout (you must copy it), then optionally deactivates and deletes an old key.
EOF
}

if [ "${1-}" = "" ]; then usage; exit 1; fi
USER="$1"

echo "Creating new access key for user: $USER"
new=$(aws iam create-access-key --user-name "$USER")
access_key_id=$(echo "$new" | jq -r .AccessKey.AccessKeyId)
secret_access_key=$(echo "$new" | jq -r .AccessKey.SecretAccessKey)

echo "NEW_ACCESS_KEY_ID=$access_key_id"
echo "NEW_SECRET_ACCESS_KEY=$secret_access_key"

echo "Please store these credentials securely now. Press Enter to continue to deactivate old keys." 
read -r _

echo "Listing existing keys for $USER"
aws iam list-access-keys --user-name "$USER" | jq -r '.AccessKeyMetadata[] | .AccessKeyId' > /tmp/keys.$$ || true

for kid in $(cat /tmp/keys.$$); do
  if [ "$kid" = "$access_key_id" ]; then continue; fi
  echo "Deactivating old key: $kid"
  aws iam update-access-key --user-name "$USER" --access-key-id "$kid" --status Inactive
  echo "Delete old key $kid now? (y/N)"
  read -r confirm
  if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
    aws iam delete-access-key --user-name "$USER" --access-key-id "$kid"
    echo "Deleted $kid"
  else
    echo "Left $kid inactive. Consider deleting after testing new key." 
  fi
done

rm -f /tmp/keys.$$
echo "AWS key rotation complete. Update any services to use the new key." 
