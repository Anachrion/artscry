class Rating < ApplicationRecord
  LEVELS = 1..3
  CARD_FIELDS = %i[scryfall_id name artist set_name year art_url normal_url large_url scryfall_uri].freeze

  belongs_to :user

  validates :illustration_id, presence: true, uniqueness: { scope: :user_id }
  validates :level, inclusion: { in: LEVELS }

  # Shape expected by the JavaScript (same keys as the prototype).
  def as_card
    {
      id: scryfall_id, ill: illustration_id, level: level,
      name: name, artist: artist, set: set_name, year: year,
      art: art_url, normal: normal_url, large: large_url, uri: scryfall_uri
    }
  end
end
