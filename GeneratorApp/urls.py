from django.urls import path

from . import views

urlpatterns = [
    path('', views.home_view, name='home'),
    path('index.html', views.home_view, name='home_legacy'),
    path('problems.html', views.problems_view, name='problems'),
    path('generator.html', views.generator_view, name='generator'),
    path('api/catalog/', views.catalog_api, name='catalog_api'),
    path('api/exams/generate/', views.generate_exams_api, name='generate_exams_api'),
    path('api/exams/preview/', views.preview_exam_api, name='preview_exam_api'),
    path('api/sync/status/', views.sync_status_api, name='sync_status_api'),
    path('api/sync/trigger/', views.trigger_sync_api, name='trigger_sync_api'),
    path('api/latex-preview/', views.latex_preview_api, name='latex_preview_api'),
]
