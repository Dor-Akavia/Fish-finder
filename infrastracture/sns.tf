resource "aws_sns_topic" "fish_alerts" {
  name = "fish-finder-alerts"

  # The topic is kept for:
  #   - Future mobile push notifications (SNS → platform endpoint)
  #   - Admin alerts or webhook integrations
  # The email subscription was removed because results are now displayed
  # directly in the webapp via DynamoDB polling.
}