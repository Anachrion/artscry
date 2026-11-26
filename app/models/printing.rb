class Printing < ApplicationRecord
  belongs_to :card_set, primary_key: :code, foreign_key: :set_code, optional: true
end
