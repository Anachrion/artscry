Rails.application.routes.draw do
  resource :session, only: %i[new create destroy]
  resource :registration, only: %i[new create]

  namespace :api do
    resource :state, only: :show
    resources :sets, only: :index
    resource :seen, only: %i[create destroy], controller: :seen
    resources :ratings, only: %i[update destroy], param: :illustration_id
  end

  get "up" => "rails/health#show", as: :rails_health_check

  root "explorer#show"
end
