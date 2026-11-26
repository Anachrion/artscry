class CardSet < ApplicationRecord
  has_many :printings, primary_key: :code, foreign_key: :set_code, inverse_of: false

  scope :browsable, -> { where(digital: false).where("illustration_count > 0") }
end
