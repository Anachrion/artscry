class User < ApplicationRecord
  has_secure_password
  has_many :sessions, dependent: :destroy
  has_many :seen_illustrations, dependent: :delete_all
  has_many :ratings, dependent: :delete_all

  normalizes :email_address, with: ->(e) { e.strip.downcase }

  validates :email_address, presence: true, uniqueness: true,
    format: { with: URI::MailTo::EMAIL_REGEXP }
  validates :password, length: { minimum: 8 }, allow_nil: true

  # Marks illustrations as seen in a single query, skipping duplicates.
  def mark_seen!(illustration_ids)
    ids = Array(illustration_ids).map(&:to_s).reject(&:blank?).uniq.first(500)
    return 0 if ids.empty?
    now = Time.current
    SeenIllustration.insert_all(
      ids.map { |i| { user_id: id, illustration_id: i, created_at: now } },
      unique_by: %i[user_id illustration_id]
    )
    ids.size
  end
end
