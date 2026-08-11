variable "name" { type = string }
variable "recording_retention_days" {
  type        = number
  default     = 90
  description = "Mirrors RecordingsCleanupService's RETENTION_DAYS constant (apps/api/src/recordings/recordings-cleanup.service.ts) — the app's daily cron job deletes expired recording rows+objects itself, so this bucket lifecycle rule is a backstop, not the primary mechanism. Keep the two in sync if you change one."
}

resource "aws_s3_bucket" "this" {
  bucket = "${var.name}-storage"
  tags   = { Name = "${var.name}-storage" }
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket                  = aws_s3_bucket.this.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    id     = "expire-old-recordings"
    status = "Enabled"
    filter { prefix = "recordings/" }
    expiration {
      days = var.recording_retention_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  cors_rule {
    allowed_methods = ["GET", "PUT", "POST"]
    allowed_origins = ["https://*.arutech.example.com"] # tighten to your real domain(s)
    allowed_headers = ["*"]
    max_age_seconds = 3000
  }
}

# IAM user + policy scoped to only this bucket — the credentials handed to
# S3_ACCESS_KEY/S3_SECRET_KEY should never be broader than "read/write this one
# bucket" (see docs/security.md's file-upload notes on not over-scoping storage credentials).
resource "aws_iam_user" "app" {
  name = "${var.name}-app-storage"
}

resource "aws_iam_access_key" "app" {
  user = aws_iam_user.app.name
}

resource "aws_iam_user_policy" "app" {
  name = "${var.name}-storage-access"
  user = aws_iam_user.app.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
      Resource = "${aws_s3_bucket.this.arn}/*"
      }, {
      Effect   = "Allow"
      Action   = ["s3:ListBucket"]
      Resource = aws_s3_bucket.this.arn
    }]
  })
}

output "bucket_name" { value = aws_s3_bucket.this.id }
output "access_key_id" {
  value     = aws_iam_access_key.app.id
  sensitive = true
}
output "secret_access_key" {
  value     = aws_iam_access_key.app.secret
  sensitive = true
}
