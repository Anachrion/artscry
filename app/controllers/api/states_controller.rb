module Api
  class StatesController < BaseController
    # Everything the page needs on startup: seen illustrations and rated cards.
    def show
      render json: {
        seen: current_user.seen_illustrations.pluck(:illustration_id),
        ratings: current_user.ratings.order(updated_at: :desc).map(&:as_card)
      }
    end
  end
end
