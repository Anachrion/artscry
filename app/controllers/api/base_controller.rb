module Api
  class BaseController < ApplicationController
    private
      def request_authentication
        head :unauthorized
      end

      def current_user
        Current.user
      end
  end
end
