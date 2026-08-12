#!/bin/sh
set -eu

if [ -z "${GUACAMOLE_ADMIN_PASSWORD:-}" ] || [ "$GUACAMOLE_ADMIN_PASSWORD" = "guacadmin" ]; then
  echo "GUACAMOLE_ADMIN_PASSWORD must be set to a non-default value." >&2
  exit 1
fi

salt_hex="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n' | tr '[:lower:]' '[:upper:]')"
hash_hex="$(printf '%s%s' "$GUACAMOLE_ADMIN_PASSWORD" "$salt_hex" | sha256sum | awk '{ print toupper($1) }')"

updated_count="$(
  PGPASSWORD="$POSTGRES_PASSWORD" psql \
    -h guacamole-postgres \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    -v ON_ERROR_STOP=1 \
    -At \
    -c "
WITH updated AS (
  UPDATE guacamole_user
  SET
    password_hash = decode('$hash_hex', 'hex'),
    password_salt = decode('$salt_hex', 'hex'),
    password_date = CURRENT_TIMESTAMP
  FROM guacamole_entity
  WHERE guacamole_user.entity_id = guacamole_entity.entity_id
    AND guacamole_entity.name = 'guacadmin'
    AND guacamole_entity.type = 'USER'
  RETURNING 1
)
SELECT count(*) FROM updated;
"
)"

if [ "$updated_count" != "1" ]; then
  echo "Expected to rotate exactly one Guacamole admin account, rotated $updated_count." >&2
  exit 1
fi

echo "Guacamole guacadmin password rotated."
