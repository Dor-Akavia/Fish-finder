# =============================================================================
# cognito.tf - User Authentication
#
# One User Pool shared by the webapp and mobile app.
# Two separate app clients so credentials can be rotated independently:
#   - webapp_client  (Flask API uses this to verify JWTs)
#   - mobile_client  (React Native app uses this via AWS Amplify)
# =============================================================================

resource "aws_cognito_user_pool" "fish_finder" {
  name = "fish-finder-users"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length                   = 8
    require_uppercase                = true
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Fish Finder - קוד האימות שלך"
    email_message        = "קוד האימות שלך הוא: {####}"
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  tags = { Project = "fish-finder" }
}

# App Client: Webapp (Flask API verifies JWTs issued by this client)
resource "aws_cognito_user_pool_client" "webapp_client" {
  name         = "fish-finder-webapp"
  user_pool_id = aws_cognito_user_pool.fish_finder.id

  generate_secret = false # Browser clients can't keep secrets safe

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH"
  ]

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"
}

# App Client: Mobile (React Native / AWS Amplify)
resource "aws_cognito_user_pool_client" "mobile_client" {
  name         = "fish-finder-mobile"
  user_pool_id = aws_cognito_user_pool.fish_finder.id

  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH"
  ]

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"
}
