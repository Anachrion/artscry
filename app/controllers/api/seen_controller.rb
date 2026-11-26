module Api
  class SeenController < BaseController
    # POST /api/seen  { ids: ["illustration-id", …] }
    def create
      added = current_user.mark_seen!(params[:ids])
      render json: { added: added, total: current_user.seen_illustrations.count }
    end

    # DELETE /api/seen: clears the seen history.
    def destroy
      current_user.seen_illustrations.delete_all
      head :no_content
    end
  end
end
