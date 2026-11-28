module Api
  class StatesController < BaseController
    # Everything the page needs on startup: seen illustrations, rated cards
    # and the number of distinct paper illustrations in the catalog.
    def show
      render json: {
        total: Printing.paper_illustration_count,
        seen: current_user.seen_illustrations.pluck(:illustration_id),
        ratings: current_user.ratings.order(updated_at: :desc).map(&:as_card)
      }
    end
  end
end
