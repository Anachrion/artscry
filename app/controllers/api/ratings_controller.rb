module Api
  class RatingsController < BaseController
    # PUT /api/ratings/:illustration_id  { level: 1..3, card: { name, artist, … } }
    def update
      rating = current_user.ratings.find_or_initialize_by(illustration_id: params[:illustration_id])
      rating.level = params[:level].to_i
      card = params.fetch(:card, {}).permit(:id, :name, :artist, :set, :year, :art, :normal, :large, :uri)
      rating.assign_attributes(
        scryfall_id: card[:id], name: card[:name], artist: card[:artist], set_name: card[:set],
        year: card[:year], art_url: card[:art], normal_url: card[:normal], large_url: card[:large],
        scryfall_uri: card[:uri]
      ) if card.present?
      if rating.save
        current_user.mark_seen!([ rating.illustration_id ])
        render json: rating.as_card
      else
        render json: { errors: rating.errors.full_messages }, status: :unprocessable_entity
      end
    end

    def destroy
      current_user.ratings.where(illustration_id: params[:illustration_id]).delete_all
      head :no_content
    end
  end
end
