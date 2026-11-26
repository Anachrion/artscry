module Api
  class SetsController < BaseController
    # GET /api/sets
    # Every browsable set, newest first, with the current user's progress:
    # how many of its illustrations they have seen and how many they rated.
    # An illustration reprinted in several sets counts in each of them.
    def index
      seen = Printing
        .joins("JOIN seen_illustrations s ON s.illustration_id = printings.illustration_id")
        .where(s: { user_id: current_user.id })
        .group(:set_code).count
      favs = Printing
        .joins("JOIN ratings r ON r.illustration_id = printings.illustration_id")
        .where(r: { user_id: current_user.id })
        .group(:set_code).count

      sets = CardSet.browsable.order(released_at: :desc, name: :asc).map do |s|
        {
          code: s.code, name: s.name, type: s.set_type, year: s.released_at&.year,
          icon: s.icon_svg_uri, total: s.illustration_count,
          seen: seen.fetch(s.code, 0), favs: favs.fetch(s.code, 0)
        }
      end
      render json: sets
    end
  end
end
