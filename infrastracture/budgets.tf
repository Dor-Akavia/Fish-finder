# =============================================================================
# budgets.tf - AWS Cost Alerting
#
# Emails when the monthly bill crosses two thresholds:
#   50%  - early warning
#   100% forecasted - prevents bill shock
#
# Adjust limit_amount to your comfort level.
# =============================================================================

resource "aws_budgets_budget" "fish_finder" {
  name         = "fish-finder-monthly"
  budget_type  = "COST"
  limit_amount = "20" # USD - adjust to your monthly budget ceiling
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = ["Dor.Akavia@gmail.com"]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = ["Dor.Akavia@gmail.com"]
  }
}
