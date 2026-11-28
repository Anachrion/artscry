class Printing < ApplicationRecord
  belongs_to :card_set, primary_key: :code, foreign_key: :set_code, optional: true

  # Distinct illustrations printed on paper, the denominator of the global
  # progress. Cached because it only changes when the catalog is reimported.
  def self.paper_illustration_count
    Rails.cache.fetch([ "paper_illustration_count", CardSet.maximum(:updated_at) ]) do
      joins(:card_set).where(card_sets: { digital: false }).distinct.count(:illustration_id)
    end
  end
end
